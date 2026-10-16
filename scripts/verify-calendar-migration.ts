/** 当前库只读，克隆全部表后演练校历修订/故障回滚。保留演练库与原备份。 */
import mysql from "mysql2/promise";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
const [source,socketPath,file,entry="scripts/align-school-calendar.ts"] = process.argv.slice(2);
if(!/^(zjgsu_v3_20261016|zjgsu_history_test_[a-f0-9]{10})$/.test(source||"")||!["/tmp/mysql.sock","/var/run/mysqld/mysqld.sock"].includes(socketPath)||!file)throw new Error("仅接受已核实源库及原课表");
const root=await mysql.createConnection({socketPath,user:"root",dateStrings:true});
const database=`zjgsu_history_test_${randomBytes(5).toString("hex")}`;
let passed=0;
const assert=(value:unknown,label:string)=>{if(!value)throw new Error(label);passed++;};
const hash=(rows:unknown)=>createHash("sha256").update(JSON.stringify(rows)).digest("hex");
async function snapshot(db:string){const [tables]=await root.query<any[]>(`SHOW TABLES FROM \`${db}\``);const result:Record<string,any[]>={};for(const row of tables){const table=String(Object.values(row)[0]);if(!/^[a-z0-9_]+$/.test(table))throw new Error("表名不符");result[table]=(await root.query<any[]>(`SELECT * FROM \`${db}\`.\`${table}\` ORDER BY id`))[0];}return result;}
async function run(apply=false){const args=[database,socketPath,file,...(apply?["--apply"]:[])];const child=entry.endsWith(".ts")?spawn("pnpm",["exec","tsx",entry,...args],{stdio:["ignore","pipe","pipe"]}):spawn(process.execPath,[entry,...args],{stdio:["ignore","pipe","pipe"]});let output="";child.stdout.on("data",b=>output+=b);child.stderr.on("data",()=>{});const [code]=await once(child,"exit");return {code,output};}
try{
  await root.query("SET time_zone='+00:00'");
  const before=await snapshot(source);await root.query(`CREATE DATABASE \`${database}\``);
  for(const table of Object.keys(before)){await root.query(`CREATE TABLE \`${database}\`.\`${table}\` LIKE \`${source}\`.\`${table}\``);await root.query(`INSERT INTO \`${database}\`.\`${table}\` SELECT * FROM \`${source}\`.\`${table}\``);}
  assert(hash(before)===hash(await snapshot(database)),"全部表克隆一致");
  const preview=await run();assert(preview.code===0&&hash(before)===hash(await snapshot(database)),"预检无写入");
  const info=JSON.parse(preview.output.slice(preview.output.indexOf('{')));
  assert(info.updates>50&&info.preSemesterSessions===45,"原文件45场第0周及真实周次修订");
  // 仅对新建隔离库注入更新故障，验证已更新的前批课程也回滚。
  const ids=before.courses.filter(c=>c.college==="MBA学院"&&c.semesterId===info.semesterId).map(c=>c.id).sort((a,b)=>a-b);
  const failId=ids[Math.floor(ids.length/2)];
  await root.query(`CREATE TRIGGER \`${database}\`.calendar_fault BEFORE UPDATE ON \`${database}\`.courses FOR EACH ROW BEGIN IF NEW.id=${failId} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated calendar failure'; END IF; END`);
  assert((await run(true)).code!==0&&hash(before)===hash(await snapshot(database)),"半途失败全9表完整回滚");await root.query(`DROP TRIGGER \`${database}\`.calendar_fault`);
  const applied=await run(true);assert(applied.code===0,"真实修订事务成功");const after=await snapshot(database);
  for(const [table,rows] of Object.entries(before)){
    if(table!=="courses"&&table!=="semesters"){assert(hash(rows)===hash(after[table]),`${table}逐行不变`);continue;}
    const normalize=(records:any[])=>records.map(r=>{if(table==="courses"&&r.college==="MBA学院"&&r.semesterId===info.semesterId){const {weekNumbers,customWeeks,weekType,updatedAt,...stable}=r;return stable;}if(table==="semesters"&&r.id===info.semesterId){const {mbaStartDate,mbaTotalWeeks,updatedAt,...stable}=r;return stable;}return r;});
    assert(hash(normalize(rows))===hash(normalize(after[table])),`${table}仅允许的当前MBA周次/兼容字段变化，历史不变`);
  }
  const again=await run(true);assert(again.code===0&&JSON.parse(again.output.slice(again.output.indexOf('{'))).updates===0,"重复修订幂等");
  assert(hash(before)===hash(await snapshot(source)),"源库全部9表未改动");
  console.log(JSON.stringify({database,passed,result:"PASS",migration:JSON.parse(applied.output.slice(applied.output.indexOf('{')))},null,2));
}catch(error){console.error(error instanceof Error&&!("sql" in error)?error.message:"隔离演练未通过，未输出SQL或凭据");process.exitCode=1;}
finally{await root.end();}
