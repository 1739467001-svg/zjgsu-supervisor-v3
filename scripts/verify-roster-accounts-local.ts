/** 正式通讯录逐人验收：原名单/历史兼容库只读，新建隔离克隆库进行登录和业务写入。 */
import fs from "node:fs/promises";
import mysql from "mysql2/promise";
import net from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { parsePersonnelWorkbook } from "./import-users";
import { isAccountDisabled, isPasswordHash, verifyPassword } from "../server/passwords";
import { getEffectiveRoles, isCollegeInScope } from "../shared/roles";
import { REQUIRED_SCORE_FIELDS } from "../shared/evaluationValidation";

const [rosterPath, source, mode] = process.argv.slice(2);
if (!rosterPath || !/^zjgsu_history_test_[a-f0-9]{10}$/.test(source || "")) throw new Error("仅允许指定通讯录和本轮独立历史兼容库");
const rosterBefore = await fs.readFile(rosterPath);
const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const parsed = parsePersonnelWorkbook(rosterPath);
const root = await mysql.createConnection({ socketPath: "/tmp/mysql.sock", user: "root", dateStrings: true });
const [users] = await root.query<any[]>(`SELECT * FROM \`${source}\`.users ORDER BY id`);
const sourceHash = digest(JSON.stringify(users));
const formal = parsed.people.map(person => ({ person, user: users.find(user => user.employeeId === person.employeeId) }));
const dual = formal.filter(({ person }) => person.extraRoles.length);
const issues = formal.filter(({ person, user }) => !user || user.name !== person.name || user.role !== person.role || JSON.stringify(getEffectiveRoles(user).sort()) !== JSON.stringify([person.role, ...person.extraRoles].sort()) || user.college !== person.college || user.supervisorScope !== person.supervisorScope || isAccountDisabled(user.password));
const credentialCounts = { initial: 0, legacyChanged: 0, hashedChangedUnknown: 0, disabled: 0 };
for (const { person, user } of formal) {
  if (!user) continue;
  if (isAccountDisabled(user.password)) credentialCounts.disabled++;
  else if (await verifyPassword(person.employeeId, user.password, person.employeeId)) credentialCounts.initial++;
  else if (isPasswordHash(user.password)) credentialCounts.hashedChangedUnknown++;
  else credentialCounts.legacyChanged++;
}
console.log(JSON.stringify({ formalPeople: formal.length, dualPeople: dual.length, mergedRows: parsed.mergedCount, parseProblems: parsed.problems.length, profileIssues: issues.length, credentialCounts, ...(mode !== "--verify" ? { dualPeopleNames: dual.map(({ person }) => ({ name: person.name, college: person.college, sourceRoles: person.sourceRoles })) } : {}) }, null, 2));
if (mode !== "--verify") { await root.end(); process.exit(issues.length || parsed.problems.length ? 1 : 0); }
if (formal.length !== 100 || dual.length !== 26 || parsed.problems.length || issues.length) throw new Error("名单/角色/学院/账号对账未通过，停止业务验收");
if (credentialCounts.hashedChangedUnknown || credentialCounts.disabled) throw new Error("存在未知已改密或停用账号，不能冒充原凭据登录通过；原库未修改");
const suffix = randomBytes(5).toString("hex"), database = `zjgsu_roster_test_${suffix}`, account = `roster_${suffix}`;
const databasePassword = randomBytes(32).toString("hex"), secret = randomBytes(48).toString("hex"), port = 3110;
const base = `http://127.0.0.1:${port}`;
let child: ReturnType<typeof spawn> | undefined, passed = 0, loginCount = 0;
function assert(value: unknown, label: string): asserts value { if (!value) throw new Error(label); passed++; }
async function call(route: string, input: unknown, cookie = "", mutation = false) {
  const encoded = JSON.stringify({ json: input });
  const response = await fetch(`${base}/api/trpc/${route}${mutation ? "" : `?input=${encodeURIComponent(encoded)}`}`, { method: mutation ? "POST" : "GET", headers: { "content-type": "application/json", cookie }, ...(mutation ? { body: encoded } : {}), signal: AbortSignal.timeout(20000) });
  const body: any = await response.json();
  return { status: response.status, data: body.result?.data?.json, cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
}
async function stop() { if (child?.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); } child = undefined; }
async function start() {
  await stop();
  child = spawn(process.execPath, ["dist/index.js"], { cwd: process.cwd(), stdio: "ignore", env: { ...process.env, NODE_ENV: "production", APP_HOST: "127.0.0.1", PORT: String(port), DISABLE_SCHEDULER: "1", TRUST_PROXY: "", DOTENV_CONFIG_PATH: "/dev/null", DATABASE_URL: `mysql://${account}:${databasePassword}@127.0.0.1:3306/${database}`, JWT_SECRET: secret, OAUTH_SERVER_URL: "", BUILT_IN_FORGE_API_URL: "", BUILT_IN_FORGE_API_KEY: "" } });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/health`)).ok) { loginCount = 0; return; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error("独立账号验收服务未启动");
}
async function login(employeeId: string, password: string) {
  // 独立进程分批验收；不关闭账号/IP登录限流，也不影响3000预览。
  if (loginCount >= 40) await start();
  loginCount++;
  return call("auth.loginByEmployeeId", { employeeId, password }, "", true);
}
const rows: any[] = [];
try {
  const listener = net.createServer(); await new Promise<void>((resolve, reject) => { listener.once("error", reject); listener.listen(port, "127.0.0.1", () => listener.close(() => resolve())); });
  await root.query(`CREATE DATABASE \`${database}\``);
  const [tables] = await root.query<any[]>(`SHOW TABLES FROM \`${source}\``);
  for (const row of tables) {
    const table = String(Object.values(row)[0]); if (!/^[a-z0-9_]+$/.test(table)) throw new Error("异常表名，停止克隆");
    await root.query(`CREATE TABLE \`${database}\`.\`${table}\` LIKE \`${source}\`.\`${table}\``);
    await root.query(`INSERT INTO \`${database}\`.\`${table}\` SELECT * FROM \`${source}\`.\`${table}\``);
  }
  await root.query(`CREATE USER '${account}'@'127.0.0.1' IDENTIFIED BY ?`, [databasePassword]);
  await root.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON \`${database}\`.* TO '${account}'@'127.0.0.1'`);
  await start();
  const [courseRows] = await root.query<any[]>(`SELECT id,college,semesterId,weekNumbers FROM \`${database}\`.courses WHERE semesterId=(SELECT id FROM \`${database}\`.semesters WHERE isActive=1)`);
  const roleCounts: Record<string, number> = {};
  for (const { person, user } of formal) {
    const initialPassword = user.password && !isPasswordHash(user.password) ? user.password : person.employeeId;
    let session = await login(person.employeeId, initialPassword);
    assert(session.status === 200 && session.cookie, "正式账号原凭据登录失败");
    assert(session.data.user.id === user.id && session.data.user.employeeId === person.employeeId, "登录人或原作者ID不符");
    assert(JSON.stringify(getEffectiveRoles(session.data.user).sort()) === JSON.stringify([person.role, ...person.extraRoles].sort()), "登录响应双身份配置不符");
    assert(!("password" in session.data.user), "登录接口泄露密码");
    const forceChange = session.data.user.passwordChangeRequired;
    if (forceChange) {
      assert((await call("courses.list", {}, session.cookie)).status === 403, "默认密码业务门禁未生效");
      const temporaryPassword = `Local-only-${randomBytes(16).toString("hex")}`;
      assert((await call("auth.changePassword", { oldPassword: initialPassword, newPassword: temporaryPassword }, session.cookie, true)).status === 200, "隔离克隆账号初始改密失败");
      assert((await call("semesters.list", undefined, session.cookie)).status === 401, "改密后旧会话未失效");
      session = await login(person.employeeId, temporaryPassword);
      assert(session.status === 200 && session.cookie && !session.data.user.passwordChangeRequired, "改密后重新登录失败");
    }
    const terms = await call("semesters.list", undefined, session.cookie);
    assert(terms.status === 200, "学期查询失败"); const active = terms.data.find((term: any) => term.isActive);
    const courseList = await call("courses.list", { semesterId: active.id, pageSize: 100 }, session.cookie);
    assert(courseList.status === 200, "课程查询失败");
    const limited = person.scopeLimited, expectedCourses = limited ? courseRows.filter(course => isCollegeInScope(person.college!, course.college)) : courseRows;
    assert(courseList.data.total === expectedCourses.length && courseList.data.data.every((course: any) => course.semesterId === active.id && (!limited || isCollegeInScope(person.college!, course.college))), `第${rows.length + 1}位人员实际课程范围不符（应有${expectedCourses.length}门，实际${courseList.data.total}门）`);
    const teachers = await call("courses.getTeachers", { semesterId: active.id }, session.cookie);
    assert(teachers.status === 200 && (expectedCourses.length === 0 || teachers.data.length > 0), "对应学院授课教师筛选不可用");
    const supervise = getEffectiveRoles(user).some(role => ["graduate_admin", "supervisor_expert", "supervisor_leader", "admin"].includes(role));
    const manage = getEffectiveRoles(user).some(role => ["graduate_admin", "admin"].includes(role));
    const collegeManage = getEffectiveRoles(user).includes("college_secretary");
    assert((await call("plans.myPlans", { semesterId: active.id }, session.cookie)).status === (supervise ? 200 : 403), "听课计划授权错误");
    assert((await call("users.list", undefined, session.cookie)).status === (manage ? 200 : 403), "人员管理授权错误");
    assert((await call("stats.adminDashboard", { semesterId: active.id }, session.cookie)).status === (manage || collegeManage ? 200 : 403), "管理统计授权错误");
    assert((await call("stats.allCollegeProgress", { semesterId: active.id }, session.cookie)).status === (manage ? 200 : 403), "全校统计边界错误");
    const evaluations = await call("evaluations.allEvaluations", { semesterId: active.id }, session.cookie);
    assert(evaluations.status === 200 && evaluations.data.every((item: any) => item.semesterId === active.id && (manage || collegeManage || item.supervisorId === user.id)), "评价查询作者范围错误");
    if (limited) {
      const outside = courseRows.find(course => !isCollegeInScope(person.college!, course.college));
      assert(outside && (await call("courses.getById", outside.id, session.cookie)).status === 403, "外院课程访问未拦截");
    }
    let dualFlow = false;
    if (person.extraRoles.length) {
      const course = expectedCourses.find(course => { const weeks = typeof course.weekNumbers === "string" ? JSON.parse(course.weekNumbers) : course.weekNumbers; return Array.isArray(weeks) && weeks.includes(2); });
      assert(course, "双身份账号没有可验收的有效课程");
      const plan = await call("plans.create", { courseId: course.id, planWeek: 2, note: "仅隔离库的双身份验收计划" }, session.cookie, true);
      assert(plan.status === 200, "双身份创建听课计划失败");
      const evaluation = await call("evaluations.create", { courseId: course.id, planId: plan.data.id, actualWeek: 2, highlights: "隔离验收记录", status: "draft" }, session.cookie, true);
      assert(evaluation.status === 200 && evaluation.data.status === "draft", "双身份保存草稿失败");
      const full = { ...Object.fromEntries(REQUIRED_SCORE_FIELDS.map(field => [field, 4])), courseId: course.id, planId: plan.data.id, actualWeek: 2, score_research_teaching: 4, overallScore: 4, highlights: "隔离验收：教学亮点", suggestions: "隔离验收：提升建议", status: "submitted" };
      assert((await call("evaluations.update", { id: evaluation.data.id, data: full }, session.cookie, true)).status === 200, "双身份正式评价提交失败");
      const detail = await call("evaluations.getById", evaluation.data.id, session.cookie);
      assert(detail.status === 200 && detail.data.supervisorId === user.id && detail.data.planId === plan.data.id, "双身份评价作者或计划关联错误");
      assert((await fetch(`${base}/api/print/evaluation/${evaluation.data.id}`, { headers: { cookie: session.cookie } })).status === 200, "双身份本人评价打印失败");
      const stats = await call("stats.adminDashboard", { semesterId: active.id }, session.cookie);
      assert(stats.status === 200 && stats.data.totalCourses === expectedCourses.length && stats.data.semesterColleges.every((item: any) => !limited || isCollegeInScope(person.college!, item.college)), "双身份管理统计学院范围错误");
      dualFlow = true;
    }
    const key = person.sourceRoles.join(" + "); roleCounts[key] = (roleCounts[key] || 0) + 1;
    rows.push({ name: person.name, college: person.college, sourceRoles: person.sourceRoles, roles: [person.role, ...person.extraRoles], supervisorScope: person.supervisorScope, originalLogin: true, forcedChangeTest: forceChange, courseCount: expectedCourses.length, accessChecks: true, dualFlow });
    console.log(`通过：已验收 ${rows.length}/100 位正式人员${dualFlow ? "（含双身份计划、评分、统计、打印）" : ""}`);
  }
  const [after] = await root.query<any[]>(`SELECT * FROM \`${source}\`.users ORDER BY id`);
  assert(digest(JSON.stringify(after)) === sourceHash, "原历史兼容库账号被改动");
  assert(digest(await fs.readFile(rosterPath)) === digest(rosterBefore), "原通讯录被改动");
  const report = { sourceDatabase: source, database, rosterSha256: digest(rosterBefore), people: rows.length, dualPeople: dual.length, passed, credentialCounts, roleCounts, sourceUnchanged: true, rows, result: "PASS" };
  await fs.mkdir("tmp/acceptance", { recursive: true });
  await fs.writeFile("tmp/acceptance/roster-accounts-report.json", JSON.stringify(report, null, 2), { mode: 0o600 });
  const lines = ["# 通讯录逐人账号与双身份验收", "", "原通讯录只读，原历史兼容库账号未修改。以下为新建独立克隆库中的真实HTTP验证，不代表生产账号已迁移。", "", `正式人员${rows.length}人，双身份${dual.length}人，${passed}项断言通过。所有人使用原凭据登录；初始密码账号在隔离库完成改密、旧会话失效与重新登录。密码、Cookie、工号及联系方式不输出。`, "", "## 需要切换身份的26位人员", "", "| 姓名 | 学院 | 可切换身份 | 登录/业务 |", "| --- | --- | --- | --- |", ...dual.map(({ person }) => `| ${person.name} | ${person.college || "研究生院"} | ${person.role === "graduate_admin" ? "研究生院主管 / 校级督导" : "院级督导 / 学院管理"} | 登录、计划、草稿、正式提交、详情、打印及统计通过 |`), "", "## 全部100位人员", "", "| 姓名 | 学院 | 通讯录角色 | 登录及权限 |", "| --- | --- | --- | --- |", ...rows.map(row => `| ${row.name} | ${row.college || "—"} | ${row.sourceRoles.join(" + ")} | 通过 |`), "", "身份切换界面另用两种虚构双身份实测。身份视图只改变工作台，完整授权保留；学院领导始终只限本院，秘书不具有评分或账号管理能力。", ""];
  await fs.writeFile("tmp/acceptance/通讯录逐人账号与双身份验收.md", lines.join("\n"), { mode: 0o600 });
  console.log(JSON.stringify({ database, people: rows.length, dualPeople: dual.length, passed, credentialCounts, sourceUnchanged: true, result: "PASS" }));
} catch (error) { console.error(error instanceof Error && !("sql" in error) ? error.message : "账号验收未完成，未输出数据库配置或凭据"); process.exitCode = 1; }
finally { await stop(); await root.query(`DROP USER IF EXISTS '${account}'@'127.0.0.1'`); await root.end(); }
