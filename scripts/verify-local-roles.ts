/** 真实 HTTP 验收，仅针对专用虚构数据预览库，不读取生产配置。 */
import mysql from "mysql2/promise";
import { REQUIRED_SCORE_FIELDS } from "../shared/evaluationValidation";
const base = "http://127.0.0.1:3000";
const connection = await mysql.createConnection({ socketPath: "/tmp/mysql.sock", user: "root", database: "zjgsu_preview_20261004" });
const password = "Local-acceptance-test-2026";
let passed = 0;
function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`验收失败：${label}`);
  console.log(`通过：${label}`); passed++;
}
async function call(path: string, input: unknown, cookie = "", mutation = false) {
  const encoded = JSON.stringify({ json: input });
  const response = await fetch(`${base}/api/trpc/${path}${mutation ? "" : `?input=${encodeURIComponent(encoded)}`}`, {
    method: mutation ? "POST" : "GET", headers: { "content-type": "application/json", cookie }, ...(mutation ? { body: encoded } : {}),
  });
  const body = await response.json();
  return { status: response.status, data: body.result?.data?.json, cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
}
try {
  const [rows] = await connection.query("SELECT id, employeeId FROM users ORDER BY id");
  assert((rows as any[]).length === 7 && (rows as any[]).every(row => /^local-test-[1-7]$/.test(row.employeeId)), "只连接七个虚构账号的专用预览库");
  const cookies = new Map<number, string>();
  for (let index = 1; index <= 7; index++) {
    const employeeId = `local-test-${index}`;
    let login = await call("auth.loginByEmployeeId", { employeeId, password }, "", true);
    if (login.status !== 200) login = await call("auth.loginByEmployeeId", { employeeId, password: employeeId }, "", true);
    assert(login.status === 200 && login.cookie, `角色 ${index} 正常登录`);
    assert(!("password" in login.data.user), `角色 ${index} 接口不泄露密码`);
    if (login.data.user.passwordChangeRequired) {
      const changed = await call("auth.changePassword", { oldPassword: employeeId, newPassword: password }, login.cookie, true);
      assert(changed.status === 200, `角色 ${index} 可完成初始改密`);
      assert((await call("semesters.list", undefined, login.cookie)).status === 401, `角色 ${index} 旧会话失效`);
      login = await call("auth.loginByEmployeeId", { employeeId, password }, "", true);
      assert(login.status === 200, `角色 ${index} 新密码可登录`);
    }
    cookies.set(index, login.cookie);
  }
  const [courseRows] = await connection.query("SELECT id, college, semesterId FROM courses ORDER BY id");
  const active = await call("semesters.list", undefined, cookies.get(1));
  const semester = active.data.find((item: any) => item.isActive);
  const current = (courseRows as any[]).find(row => row.semesterId === semester.id && row.college === "工商管理学院");
  const outside = (courseRows as any[]).find(row => row.semesterId === semester.id && row.college === "MBA学院");
  const historical = (courseRows as any[]).find(row => row.semesterId !== semester.id);
  for (const index of [1, 2, 6]) {
    const stats = await call("stats.adminDashboard", { semesterId: semester.id }, cookies.get(index));
    assert(stats.status === 200 && stats.data.totalCourses === (courseRows as any[]).filter(r => r.semesterId === semester.id).length, `全校管理角色 ${index} 统计与课程数一致`);
    assert(stats.data.semesterColleges.reduce((n: number, r: any) => n + r.totalCourses, 0) === stats.data.totalCourses, `全校管理角色 ${index} 学院明细合计一致`);
  }
  for (const index of [3, 4]) assert((await call("stats.adminDashboard", { semesterId: semester.id }, cookies.get(index))).status === 403, `单身份督导 ${index} 无管理统计权限`);
  for (const index of [5, 7]) {
    const stats = await call("stats.adminDashboard", { semesterId: semester.id }, cookies.get(index));
    assert(stats.status === 200 && stats.data.semesterColleges.every((r: any) => r.college === "工商管理学院"), `学院管理角色 ${index} 统计无外院数据`);
    assert((await call("stats.allCollegeProgress", { semesterId: semester.id }, cookies.get(index))).status === 403, `学院管理角色 ${index} 不能直调全校进度`);
    assert((await call("users.list", undefined, cookies.get(index))).status === 403, `学院管理角色 ${index} 无全校账号管理`);
    const summary = await call("stats.collegeStats", { semesterId: semester.id }, cookies.get(index));
    assert(summary.status === 200 && summary.data.evaluatedCourses === new Set(summary.data.evaluations.filter((e: any) => e.status === "submitted").map((e: any) => e.courseId)).size, `学院管理角色 ${index} 已督导课程去重`);
  }
  for (const index of [1,2,3,4,5,6,7]) {
    const old = await call("courses.list", { semesterId: historical.semesterId, pageSize: 100 }, cookies.get(index));
    assert(old.status === 200 && old.data.data.every((r: any) => r.semesterId === historical.semesterId), `角色 ${index} 历史课程隔离`);
    const evals = await call("evaluations.allEvaluations", { semesterId: historical.semesterId }, cookies.get(index));
    assert(evals.status === 200 && evals.data.every((r: any) => r.semesterId === historical.semesterId), `角色 ${index} 历史评价隔离`);
  }
  for (const index of [4, 5, 7]) {
    assert((await call("courses.getById", outside.id, cookies.get(index))).status === 403, `院级角色 ${index} 不可访问其他学院课程`);
    assert((await call("courses.getById", current.id, cookies.get(index))).status === 200, `院级角色 ${index} 可查看本院课程`);
    assert((await call("stats.courseCount", { semesterId: semester.id }, cookies.get(index))).data.total === (courseRows as any[]).filter(row => row.semesterId === semester.id && row.college === "工商管理学院").length, `院级角色 ${index} 首页课程数只统计本院`);
  }
  assert((await call("plans.create", { courseId: current.id, planWeek: 4 }, cookies.get(5), true)).status === 403, "单身份秘书不能创建督导计划");
  for (const index of [2, 3, 4, 6, 7]) {
    const used = await call("plans.getUsedWeeks", { courseId: current.id }, cookies.get(index));
    const week = Array.from({ length: semester.totalWeeks }, (_, i) => i + 1).find(value => !used.data.usedWeeks.includes(value));
    assert(week != null, `督导角色 ${index} 有可用测试周次`);
    assert((await call("plans.create", { courseId: historical.id, planWeek: 4 }, cookies.get(index), true)).status === 403, `督导角色 ${index} 历史学期不可新增计划`);
    const plan = await call("plans.create", { courseId: current.id, planWeek: week }, cookies.get(index), true);
    assert(plan.status === 200 && plan.data.id, `督导角色 ${index} 创建自己的计划`);
    const created = (await call("plans.myPlans", { semesterId: semester.id }, cookies.get(index))).data.find((row: any) => row.id === plan.data.id);
    assert(created?.evaluationId == null, `督导角色 ${index} 新周次计划不带入同课其他周的评价`);
    assert((await call("plans.updateStatus", { planId: plan.data.id, status: "pending" }, cookies.get(index), true)).status === 200, `督导角色 ${index} 修改自己的计划`);
    const alternative = Array.from({ length: semester.totalWeeks }, (_, i) => i + 1).find(value => value !== week && !used.data.usedWeeks.includes(value));
    assert(alternative != null, `督导角色 ${index} 有可用修改周次`);
    assert((await call("plans.update", { planId: plan.data.id, planWeek: alternative, note: "虚构验收：调整周次与备注" }, cookies.get(index), true)).status === 200, `督导角色 ${index} 修改计划周次及备注`);
    const changed = (await call("plans.myPlans", { semesterId: semester.id }, cookies.get(index))).data.find((row: any) => row.id === plan.data.id);
    assert(changed?.planWeek === alternative && changed.note === "虚构验收：调整周次与备注", `督导角色 ${index} 修改内容已持久化`);
    assert((await call("plans.update", { planId: plan.data.id, planWeek: week, note: "虚构验收：最终听课周次" }, cookies.get(index), true)).status === 200, `督导角色 ${index} 修改回待评价周次`);
    assert((await call("plans.update", { planId: plan.data.id, planWeek: week, note: "越权修改" }, cookies.get(index === 3 ? 4 : 3), true)).status === 403, `督导角色 ${index} 的计划不允许他人修改`);
    const payload = { ...Object.fromEntries(REQUIRED_SCORE_FIELDS.map(key => [key, 4])), courseId: current.id, planId: plan.data.id, actualWeek: week, overallScore: 4, score_research_teaching: 4, highlights: "虚构验收：教学亮点", suggestions: "虚构验收：提升建议", status: "submitted" };
    const evaluation = await call("evaluations.create", { courseId: current.id, planId: plan.data.id, actualWeek: week, highlights: "虚构草稿", status: "draft" }, cookies.get(index), true);
    assert(evaluation.status === 200 && evaluation.data.id && evaluation.data.status === "draft", `督导角色 ${index} 保存评分草稿`);
    const linked = (await call("plans.myPlans", { semesterId: semester.id }, cookies.get(index))).data.find((row: any) => row.id === plan.data.id);
    assert(linked?.evaluationId === evaluation.data.id && linked.evaluationStatus === "draft", `督导角色 ${index} 计划只关联自己的对应草稿`);
    assert((await call("plans.update", { planId: plan.data.id, planWeek: week, note: "不可改关联" }, cookies.get(index), true)).status === 400, `督导角色 ${index} 草稿关联后计划不能修改`);
    assert((await call("evaluations.update", { id: evaluation.data.id, data: { courseId: current.id, status: "submitted" } }, cookies.get(index), true)).status === 400, `督导角色 ${index} 不能提交不完整评分`);
    assert((await call("evaluations.update", { id: evaluation.data.id, data: payload }, cookies.get(index), true)).status === 200, `督导角色 ${index} 草稿修改并完整提交`);
    assert((await call("evaluations.getById", evaluation.data.id, cookies.get(index))).status === 200, `督导角色 ${index} 可读自己的评价`);
    assert((await fetch(`${base}/api/print/evaluation/${evaluation.data.id}`, { headers: { cookie: cookies.get(index)! } })).status === 200, `督导角色 ${index} 可打印自己的评价`);
    if (index === 6) assert((await call("evaluations.getById", evaluation.data.id, cookies.get(3))).status === 403, "其他校级督导不可读取别人的评价");
    assert((await call("evaluations.exportSingleToExcel", { evalId: evaluation.data.id }, cookies.get(index), true)).status === 200, `督导角色 ${index} 可导出本人评价`);
    if (index === 6) assert((await fetch(`${base}/api/print/evaluation/${evaluation.data.id}`, { headers: { cookie: cookies.get(3)! } })).status === 403, "其他校级督导不可打印别人的评价");
  }
  assert((await call("semesters.list", undefined, cookies.get(1))).data.find((s: any) => s.isActive).id === semester.id, "历史查询没有改变全校当前学期");
  console.log(`本地真实接口验收完成：${passed} 项通过。虚构评价保留在专用预览库，未删除数据。`);
} finally { await connection.end(); }
