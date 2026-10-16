/** 显式校历修订工具：复用正式课表解析与导入规划，只更新未关联的MBA排课周次。
 * 默认只读预检；部署时先停业务写入并备份，再显式 --apply。绝不创建/删除课程。
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { eq, inArray } from "drizzle-orm";
import { courses, semesters, listeningPlans, courseEvaluations } from "../drizzle/schema";
import { parseCourseWorkbook, mergeDuplicateCourses } from "../server/courseImport";
import { courseUploadPlan, type ExistingCourse } from "../server/courseUploadPlan";
import { courseCalendar } from "../shared/courseCalendar";
const [database, socketPath, file, action] = process.argv.slice(2);
if (!/^(zjgsu_history_test_[a-f0-9]{10}|zjgsu_v3_20261016)$/.test(database || "") || !["/tmp/mysql.sock", "/var/run/mysqld/mysqld.sock"].includes(socketPath) || !file || ![undefined,"--apply"].includes(action)) throw new Error("需要准确的隔离/正式库、socket和原MBA课表；默认预检，--apply才写入");
const buffer=fs.readFileSync(file), conn=await mysql.createConnection({socketPath,user:"root",database});
const db=drizzle(conn);
try {
  const report=await db.transaction(async tx=>{
    const terms=await tx.select().from(semesters).orderBy(semesters.id).for("update");
    const semester=terms.find(s=>s.isActive);
    if (!semester || semester.academicYear!=="2026-2027" || semester.name!=="第一学期" || semester.startDate!=="2026-09-14" || semester.totalWeeks!==18) throw new Error("学期不符合本次学校校历，停止");
    const existing=await tx.select().from(courses).where(eq(courses.semesterId,semester.id)).orderBy(courses.id).for("update");
    const mba=existing.filter(c=>c.college==="MBA学院"), ids=mba.map(c=>c.id);
    if(!ids.length)throw new Error("没有现有MBA课表，不能把校历修订当首次导入");
    const evaluations=await tx.select().from(courseEvaluations).where(inArray(courseEvaluations.courseId,ids)).for("update");
    const plans=await tx.select().from(listeningPlans).where(inArray(listeningPlans.courseId,ids)).for("update");
    if(evaluations.length||plans.length)throw new Error("MBA已有计划或评价，不能自动改周次；须逐项核对实际听课日期，原数据未改动");
    const parsed=parseCourseWorkbook(buffer,{semesterStartDate:courseCalendar(semester).startDate,totalWeeks:semester.totalWeeks});
    if(parsed.format!=="mba")throw new Error("必须使用原MBA课表");
    const incoming=mergeDuplicateCourses(parsed.courses).merged;
    if(incoming.some(c=>c.academicYear!==semester.academicYear||c.semester!==semester.name))throw new Error("原文件学期不一致");
    const plan=courseUploadPlan(incoming,mba as ExistingCourse[],new Set(),"mba");
    if(plan.inserts.length||plan.conflicts.length||plan.preserved||incoming.length!==mba.length)throw new Error("原课表与线上课程标识不完全一致，不能自动修订");
    const permitted=new Set(["weekNumbers","customWeeks","weekType"]);
    for(const item of plan.updates){
      const old=mba.find(c=>c.id===item.id)!;
      for(const key of Object.keys(item.data) as (keyof typeof item.data)[]) if(!permitted.has(key)&&JSON.stringify(old[key]??null)!==JSON.stringify(item.data[key]??null))throw new Error("除周次以外的课程内容发生变化，停止自动修订");
    }
    const digest=(rows:unknown)=>createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    const before=digest(existing);
    if(action==="--apply"){
      for(const {id,data} of plan.updates) await tx.update(courses).set({weekNumbers:data.weekNumbers,customWeeks:data.customWeeks,weekType:data.weekType}).where(eq(courses.id,id));
      // 旧版本也读取相同起点，便于代码回滚；历史学期不改动。
      await tx.update(semesters).set({mbaStartDate:semester.startDate,mbaTotalWeeks:semester.totalWeeks}).where(eq(semesters.id,semester.id));
      const after=await tx.select().from(courses).where(eq(courses.semesterId,semester.id)).orderBy(courses.id);
      const expected=existing.map(c=>{const item=plan.updates.find(u=>u.id===c.id);return item?{...c,weekNumbers:item.data.weekNumbers,customWeeks:item.data.customWeeks,weekType:item.data.weekType}:c;});
      // updatedAt是数据库正常维护字段，其他字段逐项一致。
      const stable=(rows:typeof existing)=>rows.map(({updatedAt,...c})=>c);
      if(digest(stable(after))!==digest(stable(expected)))throw new Error("修订后完整课程核对失败，事务回滚");
    }
    return {mode:action==="--apply"?"applied":"preview",semesterId:semester.id,schoolStart:semester.startDate,sourceSha256:createHash("sha256").update(buffer).digest("hex"),mbaCourses:mba.length,updates:plan.updates.length,unchanged:plan.unchanged,preSemesterSessions:parsed.issues.filter(i=>i.kind==="pre_semester").length,preSemesterCourses:incoming.filter(c=>c.weekNumbers.includes(0)).length,onlyPreSemesterCourses:incoming.filter(c=>c.weekNumbers.length===1&&c.weekNumbers[0]===0).length,missingTeacherSessions:parsed.issues.filter(i=>i.kind==="missing_teacher").length,beforeCoursesSha256:before,result:"PASS"};
  });
  console.log(JSON.stringify(report,null,2));
}catch(error){console.error(error instanceof Error&&!("sql" in error)?error.message:"校历修订失败，事务回滚；未输出内部SQL或凭据");process.exitCode=1;}
finally{await conn.end();}
