/** 生产课表逐字段只读对账；用正式解析器，不重导、不改真实账号。 */
import fs from "node:fs";
import mysql from "mysql2/promise";
import { parseCourseWorkbook,mergeDuplicateCourses } from "../server/courseImport";
import { courseUploadPlan,type ExistingCourse } from "../server/courseUploadPlan";
const [standardFile,mbaFile]=process.argv.slice(2);
if(!standardFile||!mbaFile)throw new Error("需要两份原始课表");
const conn=await mysql.createConnection({socketPath:"/var/run/mysqld/mysqld.sock",user:"root",database:"zjgsu_v3_20261016"});
let passed=0;const assert=(ok:unknown,message:string)=>{if(!ok)throw new Error(message);passed++;};
try{
 const [terms]=await conn.query<any[]>("SELECT * FROM semesters ORDER BY id");const term=terms.find(t=>t.isActive);
 assert(term?.startDate==="2026-09-14"&&term.totalWeeks===18&&term.mbaStartDate===term.startDate&&term.mbaTotalWeeks===term.totalWeeks,"统一校历配置");
 const [rows]=await conn.query<any[]>("SELECT * FROM courses WHERE semesterId=? ORDER BY id",[term.id]);
 for(const c of rows)if(typeof c.weekNumbers==="string")c.weekNumbers=JSON.parse(c.weekNumbers);
 const sources=[standardFile,mbaFile].map(file=>parseCourseWorkbook(fs.readFileSync(file),{semesterStartDate:term.startDate,totalWeeks:term.totalWeeks}));
 const details=[];
 for(const parsed of sources){const incoming=mergeDuplicateCourses(parsed.courses).merged;const existing=rows.filter(c=>(c.college==="MBA学院")===(parsed.format==="mba"));const plan=courseUploadPlan(incoming,existing as ExistingCourse[],new Set(),parsed.format);assert(plan.inserts.length===0&&plan.updates.length===0&&plan.conflicts.length===0&&plan.preserved===0&&plan.unchanged===incoming.length,"线上全部课程逐字段与原表解析一致");details.push({format:parsed.format,courses:incoming.length,unchanged:plan.unchanged});}
 assert(rows.length===1832&&new Set(rows.map(c=>c.college)).size===24,"真实1832课程24学院");
 assert(rows.filter(c=>c.weekNumbers?.includes(0)).length===45,"45门包含开学前场次，均保留第0周");
 assert(rows.filter(c=>c.weekNumbers?.length===1&&c.weekNumbers[0]===0).length===16,"16门仅开学前课程原样留存");
 const [counts]=await conn.query<any[]>("SELECT 'users' kind,COUNT(*) n FROM users UNION ALL SELECT 'evaluations',COUNT(*) FROM course_evaluations UNION ALL SELECT 'plans',COUNT(*) FROM listening_plans UNION ALL SELECT 'historicalCourses',COUNT(*) FROM courses WHERE semesterId=1");
 assert(counts.find(r=>r.kind==="users").n===101&&counts.find(r=>r.kind==="evaluations").n===81&&counts.find(r=>r.kind==="plans").n===58&&counts.find(r=>r.kind==="historicalCourses").n===2269,"人员/历史评价/计划/历史课程总数留存");
 const report={passed,details,counts,result:"PASS",mode:"production-read-only"};fs.writeFileSync("live-course-data.json",JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report,null,2));
}catch(e){console.error(e instanceof Error&&!("sql" in e)?e.message:"生产只读课表对账失败，未输出SQL或凭据");process.exitCode=1;}
finally{await conn.end();}
