/** V3兼容性演练：原恢复库只读，只对新建克隆库增加学期关联及正式名单配置。 */
import mysql from "mysql2/promise";
import fs from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { parsePersonnelWorkbook } from "./import-users";
import { hashPassword } from "../server/passwords";
import net from "node:net";
const [source, roster, ...courseFiles] = process.argv.slice(2);
if (!/^zjgsu_restore_20261007_[a-f0-9]{10}$/.test(source || "") || !roster) throw new Error("仅允许本轮独立恢复库及正式名单");
const root = await mysql.createConnection({socketPath:"/tmp/mysql.sock",user:"root",dateStrings:true});
const suffix=randomBytes(5).toString("hex"), target=`zjgsu_history_test_${suffix}`, account=`history_${suffix}`, password=randomBytes(32).toString("hex");
const hash=(rows:any[])=>createHash("sha256").update(JSON.stringify(rows)).digest("hex");
let server: ReturnType<typeof spawn> | undefined;
async function run(script:string,args:string[],url:string){const child=spawn("pnpm",["exec","tsx",script,...args],{env:{...process.env,DATABASE_URL:url,DOTENV_CONFIG_PATH:"/dev/null"},stdio:["ignore","pipe","pipe"]});let output="",error="";child.stdout!.on("data",b=>output+=b);child.stderr!.on("data",b=>error+=b);if((await once(child,"exit"))[0]!==0){console.error(output.split('\n').filter(l=>/结论：|对不上|^  新增|^解析出/.test(l)).join('\n'));console.error(error.includes('只读核验')?'只读核验失败':error.includes('执行失败')?'人员工具执行失败':'工具运行失败');throw new Error("现有工具核验失败（敏感输出已隐去）");}return output;}
try {
  const [terms]=await root.query<any[]>(`SELECT DISTINCT academicYear,semester FROM \`${source}\`.courses`);
  if(terms.length!==1||terms[0].academicYear!=="2025-2026"||terms[0].semester!=="第二学期")throw new Error("课程学期不一致，不能自动归属");
  for(const table of ["course_evaluations","listening_plans"]){const [orphans]=await root.query<any[]>(`SELECT COUNT(*) n FROM \`${source}\`.\`${table}\` r LEFT JOIN \`${source}\`.courses c ON r.courseId=c.id WHERE c.id IS NULL`);if(orphans[0].n)throw new Error("历史关联不完整，停止归属");}
  await root.query(`CREATE DATABASE \`${target}\``);
  const [tables]=await root.query<any[]>(`SHOW TABLES FROM \`${source}\``);
  const originalHashes: Record<string,string> = {}, originalColumns: Record<string,string[]>={};
  for(const row of tables){const table=String(Object.values(row)[0]);await root.query(`CREATE TABLE \`${target}\`.\`${table}\` LIKE \`${source}\`.\`${table}\``);await root.query(`INSERT INTO \`${target}\`.\`${table}\` SELECT * FROM \`${source}\`.\`${table}\``);const [rows]=await root.query<any[]>(`SELECT * FROM \`${source}\`.\`${table}\` ORDER BY id`);originalHashes[table]=hash(rows);originalColumns[table]=Object.keys(rows[0]||{});}
  await root.query(`CREATE TABLE \`${target}\`.semesters LIKE zjgsu_preview_20261004.semesters`);
  // 开始日期来自既有系统学期配置/原春季手册，非目标学期前一天；不用于推定学期归属。
  await root.query(`INSERT INTO \`${target}\`.semesters (id,academicYear,name,startDate,totalWeeks,isActive) VALUES (1,'2025-2026','第二学期','2026-03-02',19,0),(2,'2026-2027','第一学期','2026-09-14',18,1)`);
  for(const table of ["courses","course_evaluations","listening_plans"])await root.query(`ALTER TABLE \`${target}\`.\`${table}\` ADD COLUMN semesterId int NULL`);
  await root.query(`UPDATE \`${target}\`.courses SET semesterId=1 WHERE academicYear='2025-2026' AND semester='第二学期'`);
  for(const table of ["course_evaluations","listening_plans"])await root.query(`UPDATE \`${target}\`.\`${table}\` r JOIN \`${target}\`.courses c ON r.courseId=c.id SET r.semesterId=c.semesterId,r.updatedAt=r.updatedAt`);
  await root.query(`ALTER TABLE \`${target}\`.users ADD COLUMN extraRoles json NULL, ADD COLUMN supervisorScope enum('school','college') NOT NULL DEFAULT 'school'`);
  await root.query(`ALTER TABLE \`${target}\`.users MODIFY password varchar(256), MODIFY role enum('supervisor_expert','supervisor_leader','college_secretary','graduate_admin','user','admin') NOT NULL DEFAULT 'user'`);
  await root.query(`ALTER TABLE \`${target}\`.courses MODIFY classId varchar(255)`);
  await root.query(`CREATE USER '${account}'@'127.0.0.1' IDENTIFIED BY ?`,[password]); await root.query(`GRANT SELECT,INSERT,UPDATE ON \`${target}\`.* TO '${account}'@'127.0.0.1'`);
  const url=`mysql://${account}:${password}@127.0.0.1:3306/${target}`;
  if (courseFiles.length !== 2) throw new Error("需先通过正式上传入口导入真实秋季课表，才能按当前学院核对正式名单");
  const listener=net.createServer();await new Promise<void>((resolve,reject)=>{listener.once('error',reject);listener.listen(3108,'127.0.0.1',()=>listener.close(()=>resolve()));});
  const fixturePassword=randomBytes(24).toString('hex');
  await root.query(`INSERT INTO \`${target}\`.users (id,openId,employeeId,name,role,password) VALUES (1000000,'history-verification-only','history-verification-only','独立库临时验收账号','admin',?)`,[await hashPassword(fixturePassword)]);
  server=spawn(process.execPath,['dist/index.js'],{env:{...process.env,DATABASE_URL:url,JWT_SECRET:randomBytes(48).toString('hex'),DOTENV_CONFIG_PATH:'/dev/null',NODE_ENV:'production',APP_HOST:'127.0.0.1',PORT:'3108',DISABLE_SCHEDULER:'1',OAUTH_SERVER_URL:'',BUILT_IN_FORGE_API_URL:'',BUILT_IN_FORGE_API_KEY:''},stdio:'ignore'});
  for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:3108/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const login=await fetch('http://127.0.0.1:3108/api/trpc/auth.loginByEmployeeId',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({json:{employeeId:'history-verification-only',password:fixturePassword}})});
  if(!login.ok)throw new Error('历史克隆库临时验收登录失败');const cookie=login.headers.get('set-cookie')!.split(';')[0];
  for(const [index,file] of courseFiles.entries()){
    const upload=async(action:string,token='')=>{const form=new FormData();form.set('file',new Blob([new Uint8Array(fs.readFileSync(file))]),'course.xls');form.set('format',index===0?'standard':'mba');form.set('semesterId','2');form.set('action',action);if(token)form.set('previewToken',token);const response=await fetch('http://127.0.0.1:3108/api/upload-courses',{method:'POST',headers:{cookie},body:form});const data:any=await response.json();if(!response.ok)throw new Error('历史克隆库正式课表上传失败');return data;};
    const preview=await upload('preview');await upload('apply',preview.previewToken);
  }
  // 临时账号不会进入正式名单或最终克隆库；原58个账号完全保留。
  await root.query(`DELETE FROM \`${target}\`.users WHERE id=1000000 AND employeeId='history-verification-only'`);
  const [priorUsers]=await root.query<any[]>(`SELECT id,employeeId,password FROM \`${source}\`.users ORDER BY id`);
  await run("scripts/import-users.ts",[roster,"--apply"],url);
  const [afterUsers]=await root.query<any[]>(`SELECT id,employeeId,password,role,extraRoles,supervisorScope FROM \`${target}\`.users ORDER BY id`);
  if(priorUsers.some(old=>!afterUsers.some(now=>now.id===old.id&&now.employeeId===old.employeeId&&now.password===old.password)))throw new Error("旧账号ID或密码发生变化");
  const people=parsePersonnelWorkbook(roster).people;
  if(people.length!==100||people.filter(p=>p.extraRoles.length).length!==26)throw new Error("正式名单数量不符");
  if(people.some(p=>!afterUsers.some(u=>u.employeeId===p.employeeId&&u.role===p.role&&JSON.stringify(u.extraRoles||[])===JSON.stringify(p.extraRoles)&&u.supervisorScope===p.supervisorScope)))throw new Error("正式100人角色配置不符");
  const preserve: Record<string,boolean>={};
  for(const [table,columns] of Object.entries(originalColumns)){
    const [original]=await root.query<any[]>(`SELECT * FROM \`${source}\`.\`${table}\` ORDER BY id`);
    if(hash(original)!==originalHashes[table])throw new Error("原恢复库被修改");
    if(table!=="users") {const [current]=await root.query<any[]>(`SELECT ${columns.map(c=>`\`${c}\``).join(',')} FROM \`${target}\`.\`${table}\` ${table==='courses'?'WHERE semesterId=1':''} ORDER BY id`);preserve[table]=hash(current)===originalHashes[table];if(!preserve[table])throw new Error(`历史原字段发生变化：${table}`);}
  }
  const output=await run("scripts/verify-semester-archive.ts",[],url);
  const archive=output.split('\n').filter(l=>l.startsWith('{')).map(l=>JSON.parse(l));
  const auxiliary: Record<string,any>={};
  for(const table of ["course_evaluations_orphan_backup_20260515","course_evaluations_unknown_course_fix_backup_20260506"]){const [r]=await root.query<any[]>(`SELECT COUNT(*) n,SUM(c.id IS NULL) missingCourse,SUM(u.id IS NULL) missingAuthor FROM \`${target}\`.\`${table}\` e LEFT JOIN \`${target}\`.courses c ON c.id=e.courseId LEFT JOIN \`${target}\`.users u ON u.id=e.supervisorId`);auxiliary[table]=r[0];}
  const report={sourceDatabase:source,candidateDatabase:target,sourceUnchanged:true,originalFieldsPreserved:preserve,priorUsersPreserved:priorUsers.length,formalPeople:100,dualPeople:26,totalAccounts:afterUsers.length,archive,auxiliary,result:"PASS_WITH_AUXILIARY_RECORDS_REQUIRING_REVIEW"};
  fs.writeFileSync("tmp/acceptance/history-report.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} catch(e){console.error(`历史兼容验收未完成：${e instanceof Error && !('sql' in e)?e.message:'数据库故障（未输出SQL）'}`);process.exitCode=1;}
finally{if(server){server.kill('SIGTERM');await once(server,'exit');}await root.query(`DROP USER IF EXISTS '${account}'@'127.0.0.1'`);await root.end();}
