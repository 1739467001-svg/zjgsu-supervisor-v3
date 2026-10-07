/** 真实Excel通过正式HTTP入口验收；只使用自动创建的本机独立测试库。 */
import mysql from "mysql2/promise";
import fs from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { parseCourseWorkbook, mergeDuplicateCourses, weekOfDate } from "../server/courseImport";
const files = process.argv.slice(2);
if (files.length !== 2) throw new Error("需要两份真实课表");
const suffix = randomBytes(5).toString("hex"), database = `zjgsu_test_release_${suffix}`, account = `test_${suffix}`, password = randomBytes(32).toString("hex");
const root = await mysql.createConnection({ socketPath: "/tmp/mysql.sock", user: "root" });
const base = "http://127.0.0.1:3107", tables = ["users", "courses", "semesters", "course_evaluations", "listening_plans", "notifications"];
let child: ReturnType<typeof spawn> | undefined, passed = 0;
function assert(value: unknown, label: string): asserts value { if (!value) throw new Error(label); passed++; console.log(`通过：${label}`); }
async function call(path: string, input: unknown, cookie = "", mutation = false) {
  const data = JSON.stringify({ json: input }), response = await fetch(`${base}/api/trpc/${path}${mutation ? "" : `?input=${encodeURIComponent(data)}`}`, { method: mutation ? "POST" : "GET", headers: { "content-type": "application/json", cookie }, ...(mutation ? { body: data } : {}) });
  const body: any = await response.json(); return { status: response.status, data: body.result?.data?.json, cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
}
async function upload(index: number, action: string, cookie: string, token = "", changes: Record<string, string> = {}, altered?: Buffer) {
  const body = new FormData(); body.set("file", new Blob([new Uint8Array(altered || fs.readFileSync(files[index]))]), "course.xls");
  body.set("action", action); body.set("format", index === 0 ? "standard" : "mba"); body.set("semesterId", "1"); if (token) body.set("previewToken", token);
  for (const [key,value] of Object.entries(changes)) body.set(key,value);
  const response = await fetch(`${base}/api/upload-courses`, { method: "POST", headers: { cookie }, body }); return { status: response.status, data: await response.json() as any };
}
const snapshot = async () => { const [rows] = await root.query<any[]>(`SELECT * FROM \`${database}\`.courses ORDER BY id`); return createHash("sha256").update(JSON.stringify(rows)).digest("hex"); };
try {
  const listener = net.createServer(); await new Promise<void>((resolve,reject) => { listener.once("error",reject); listener.listen(3107,"127.0.0.1",() => listener.close(() => resolve())); });
  await root.query(`CREATE DATABASE \`${database}\``);
  for (const table of tables) await root.query(`CREATE TABLE \`${database}\`.\`${table}\` LIKE zjgsu_preview_20261004.\`${table}\``);
  await root.query(`CREATE USER '${account}'@'127.0.0.1' IDENTIFIED BY ?`, [password]); await root.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON \`${database}\`.* TO '${account}'@'127.0.0.1'`);
  const url = `mysql://${account}:${password}@127.0.0.1:3306/${database}`;
  // 检查过的破坏性集成测试仅在这个新建空库运行。
  const tests = spawn("pnpm", ["exec", "vitest", "run", "server/db.integration.test.ts"], { env: { ...process.env, TEST_DATABASE_URL: url, DATABASE_URL: url, DOTENV_CONFIG_PATH: "/dev/null" }, stdio: ["ignore", "pipe", "pipe"] });
  let testOutput = ""; tests.stdout!.on("data", b => testOutput += b); tests.stderr!.on("data", () => {});
  assert((await once(tests, "exit"))[0] === 0, "独立空库10项数据库集成测试通过");
  for (const table of tables) await root.query(`TRUNCATE TABLE \`${database}\`.\`${table}\``);
  for (const [id, role] of [[1,"admin"],[2,"admin"],[3,"college_secretary"]] as const) await root.query(`INSERT INTO \`${database}\`.users (id,openId,employeeId,name,role,college) VALUES (?, ?, ?, ?, ?, '工商管理学院')`, [id,`upload-${id}`,`upload-${id}`,`虚构导入验收${id}`,role]);
  await root.query(`INSERT INTO \`${database}\`.semesters (id,academicYear,name,startDate,totalWeeks,isActive) VALUES (1,'2026-2027','第一学期','2026-09-14',18,1),(2,'2025-2026','第二学期','2026-03-02',19,0)`);
  await root.query(`INSERT INTO \`${database}\`.courses (semesterId,academicYear,semester,college,courseName) VALUES (2,'2025-2026','第二学期','工商管理学院','虚构历史保留课'),(1,'2026-2027','第一学期','工商管理学院','虚构未上传保留课')`);
  child = spawn(process.execPath,["dist/index.js"],{ env: { ...process.env, DATABASE_URL:url, JWT_SECRET:randomBytes(48).toString("hex"), NODE_ENV:"production", DOTENV_CONFIG_PATH:"/dev/null", APP_HOST:"127.0.0.1", PORT:"3107", DISABLE_SCHEDULER:"1", OAUTH_SERVER_URL:"", BUILT_IN_FORGE_API_URL:"", BUILT_IN_FORGE_API_KEY:"" }, stdio:"ignore" });
  for (let i=0;i<100;i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await new Promise(r=>setTimeout(r,100)); }
  assert((await fetch(`${base}/api/health`)).ok,"服务与数据库健康检查通过");
  let a = await call("auth.loginByEmployeeId",{employeeId:"upload-1",password:"upload-1"},"",true);
  assert((await upload(0,"preview",a.cookie)).status===403,"默认密码不能绕过上传限制");
  for (const route of ["semesters.list", "courses.list", "stats.adminDashboard", "evaluations.exportToExcel"]) assert((await call(route,route === "semesters.list" ? undefined : {},a.cookie,route === "evaluations.exportToExcel")).status===403,`默认密码不能访问${route}`);
  assert((await call("system.notifyOwner",{title:"虚构验收",content:"虚构验收"},a.cookie,true)).status===403,"默认密码不能绕过系统管理员辅助接口");
  assert((await fetch(`${base}/api/print/evaluation/1`,{headers:{cookie:a.cookie}})).status===403,"默认密码不能绕过打印限制");
  const cookies: string[] = [];
  for (let i=1;i<=3;i++) { const login=await call("auth.loginByEmployeeId",{employeeId:`upload-${i}`,password:`upload-${i}`},"",true); await call("auth.changePassword",{oldPassword:`upload-${i}`,newPassword:"Upload-local-test-2026"},login.cookie,true); cookies[i]=(await call("auth.loginByEmployeeId",{employeeId:`upload-${i}`,password:"Upload-local-test-2026"},"",true)).cookie; }
  assert((await upload(0,"preview",cookies[3])).status===403,"秘书无上传权限");
  const parsed = files.map(file=>parseCourseWorkbook(fs.readFileSync(file),{semesterStartDate:"2026-09-14",totalWeeks:18}));
  assert(parsed[0].format==="standard"&&parsed[1].format==="mba","真实文件使用现有两种解析器");
  const merged=mergeDuplicateCourses(parsed.flatMap(p=>p.courses)).merged;
  assert(weekOfDate("2026-09-14","2026-09-14")===1&&weekOfDate("2026-09-20","2026-09-14")===1&&weekOfDate("2026-09-21","2026-09-14")===2,"9月14日为第一周及周边界正确");
  const before=await snapshot(), preview=await upload(0,"preview",cookies[1]);
  assert(preview.status===200&&preview.data.applied===false&&await snapshot()===before,"真实非MBA预览不写库");
  assert((await upload(0,"apply",cookies[2],preview.data.previewToken)).status===400,"换账号旧预览失效");
  assert((await upload(0,"apply",cookies[1],preview.data.previewToken,{},Buffer.concat([fs.readFileSync(files[0]),Buffer.from("changed")]))).status===400,"文件变化旧预览失效");
  assert((await upload(0,"apply",cookies[1],preview.data.previewToken,{semesterId:"2"})).status===400,"历史学期拒绝导入");
  assert((await upload(0,"preview",cookies[1],"",{format:"mba"})).status===400,"入口格式不匹配拒绝");
  await root.query(`UPDATE \`${database}\`.users SET extraRoles='["supervisor_expert"]' WHERE id=1`);
  assert((await upload(0,"apply",cookies[1],preview.data.previewToken)).status===400,"账号授权变化旧预览失效");
  const p2=await upload(0,"preview",cookies[1]); await root.query(`UPDATE \`${database}\`.semesters SET totalWeeks=19 WHERE id=1`);
  assert((await upload(0,"apply",cookies[1],p2.data.previewToken)).status===400,"学期配置变化旧预览失效"); await root.query(`UPDATE \`${database}\`.semesters SET totalWeeks=18 WHERE id=1`);
  const p3=await upload(0,"preview",cookies[1]); await root.query(`UPDATE \`${database}\`.courses SET studentCount=1 WHERE id=2`);
  assert((await upload(0,"apply",cookies[1],p3.data.previewToken)).status===400,"课程快照变化旧预览失效");
  // 第二批插入开始后由数据库触发故障，验证第一批也回滚。不是手写SQL导入课表。
  const failName=mergeDuplicateCourses(parsed[0].courses).merged[120].courseName;
  await root.query(`CREATE TRIGGER \`${database}\`.reject_test BEFORE INSERT ON \`${database}\`.courses FOR EACH ROW BEGIN IF NEW.courseName = ? THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated injection'; END IF; END`,[failName]);
  const faultBefore=await snapshot(), fault=await upload(0,"preview",cookies[1]);
  assert((await upload(0,"apply",cookies[1],fault.data.previewToken)).status===400&&await snapshot()===faultBefore,"部分批次写入失败后完整回滚"); await root.query(`DROP TRIGGER \`${database}\`.reject_test`);
  for (const index of [1,0]) { const p=await upload(index,"preview",cookies[1]); if(index===0){const concurrent=await Promise.all([upload(index,"apply",cookies[1],p.data.previewToken),upload(index,"apply",cookies[1],p.data.previewToken)]);assert(concurrent.filter(r=>r.status===200).length===1&&concurrent.filter(r=>r.status===400).length===1,"并发首次导入仅一批成功，第二批旧快照失效");}else{const result=await upload(index,"apply",cookies[1],p.data.previewToken);assert(result.status===200&&result.data.applied,"MBA真实正式导入");} }
  const [counts]=await root.query<any[]>(`SELECT semesterId,COUNT(*) n FROM \`${database}\`.courses GROUP BY semesterId`);
  assert(Number(counts.find(r=>r.semesterId===1).n)===merged.length+1&&Number(counts.find(r=>r.semesterId===2).n)===1,"两类合计与解析一致，历史和未上传课程保留");
  const stable=await snapshot();
  for (const index of [0,1]) { const p=await upload(index,"preview",cookies[1]); const r=await upload(index,"apply",cookies[1],p.data.previewToken); assert(r.status===200&&r.data.summary.inserted===0&&r.data.summary.updated===0&&await snapshot()===stable,"重复导入幂等，ID与内容不变"); }
  // 将已导入课程关联虚构计划/评价，再修改其非关键内容制造真实冲突。
  const [real]=await root.query<any[]>(`SELECT id,studentCount FROM \`${database}\`.courses WHERE semesterId=1 AND id>2 ORDER BY id LIMIT 2`);
  for (const [i,c] of real.entries()) { await root.query(`UPDATE \`${database}\`.courses SET studentCount=studentCount+1 WHERE id=?`,[c.id]); if (i===0) await root.query(`INSERT INTO \`${database}\`.listening_plans (supervisorId,courseId,semesterId) VALUES (1,?,1)`,[c.id]); else await root.query(`INSERT INTO \`${database}\`.course_evaluations (supervisorId,courseId,semesterId) VALUES (1,?,1)`,[c.id]); }
  const protectedBefore=await snapshot(), protectedPreview=await upload(1,"preview",cookies[1]);
  assert(protectedPreview.data.summary.conflicts.length>=2,"已有计划及评价课程预览报告冲突");
  assert((await upload(1,"apply",cookies[1],protectedPreview.data.previewToken)).status===400&&await snapshot()===protectedBefore,"关联冲突阻止整批写入");
  // 并发无变化导入均可安全结束，锁确保同学期串行；再改数据库造成第二个旧令牌拒绝。
  const concurrent=await upload(0,"preview",cookies[1]);
  const results=await Promise.all([upload(0,"apply",cookies[1],concurrent.data.previewToken),upload(0,"apply",cookies[1],concurrent.data.previewToken)]);
  assert(results.every(r=>r.status===200)&&await snapshot()===protectedBefore,"并发重复确认不新增、不部分写入");
  const stats=await call("stats.adminDashboard",{semesterId:1},cookies[1]);
  assert(stats.status===200&&stats.data.totalCourses===merged.length+1,"HTTP统计与真实课程总数一致");
  const report={database,passed,parsedCourses:merged.length,colleges:new Set(merged.map(c=>c.college)).size,sources:parsed.map((p,i)=>({file:files[i],sha256:createHash("sha256").update(fs.readFileSync(files[i])).digest("hex"),format:p.format,sourceRows:p.sourceRows,parsed:p.courses.length,warnings:p.warnings})),integrationTests:10,result:"PASS"};
  fs.mkdirSync("tmp/acceptance",{recursive:true}); fs.writeFileSync("tmp/acceptance/upload-report.json",JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));
} catch (e) { console.error(`验收未完成：${e instanceof Error && !('sql' in e) ? e.message : '数据库故障（未输出SQL或凭据）'}`); process.exitCode=1; }
finally { if(child){child.kill("SIGTERM");await once(child,"exit");} await root.query(`DROP USER IF EXISTS '${account}'@'127.0.0.1'`); await root.end(); }
