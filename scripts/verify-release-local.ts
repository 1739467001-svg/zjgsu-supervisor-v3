/** 已准备的真实旧/新构建，本机独立库与真实进程切换；不访问systemd或云服务器。 */
import mysql from "mysql2/promise";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { randomBytes,createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { activateRelease,validateRelease } from "./release-update.mjs";
import { hashPassword } from "../server/passwords";
const [rootArg,oldRevision,newRevision]=process.argv.slice(2),rootPath=path.resolve(rootArg||"");
if(!rootPath.includes('/tmp/acceptance/')||!oldRevision||!newRevision)throw new Error('仅允许项目tmp/acceptance内的独立发布演练目录');
const old=await validateRelease(rootPath,path.join(rootPath,'releases',oldRevision)),next=await validateRelease(rootPath,path.join(rootPath,'releases',newRevision));
const listener=net.createServer();await new Promise<void>((resolve,reject)=>{listener.once('error',reject);listener.listen(3109,'127.0.0.1',()=>listener.close(()=>resolve()));});
const suffix=randomBytes(5).toString('hex'),database=`zjgsu_test_rollback_${suffix}`,account=`rollback_${suffix}`,password=randomBytes(32).toString('hex'),loginPassword=randomBytes(24).toString('hex'),secret=randomBytes(48).toString('hex');
const root=await mysql.createConnection({socketPath:'/tmp/mysql.sock',user:'root'});let child:ReturnType<typeof spawn>|undefined,passed=0;
function assert(value:unknown,label:string):asserts value{if(!value)throw new Error(label);passed++;console.log(`通过：${label}`);}
async function stop(){if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}child=undefined;}
const env={...process.env,NODE_ENV:'production',APP_HOST:'127.0.0.1',PORT:'3109',DISABLE_SCHEDULER:'1',DOTENV_CONFIG_PATH:'/dev/null',DATABASE_URL:`mysql://${account}:${password}@127.0.0.1:3306/${database}`,JWT_SECRET:secret,OAUTH_SERVER_URL:'',BUILT_IN_FORGE_API_URL:'',BUILT_IN_FORGE_API_KEY:''};
async function restart(release:any){await stop();child=spawn(process.execPath,['dist/index.js'],{cwd:release.target,env:{...env,RELEASE_COMMIT:release.manifest.revision},stdio:'ignore'});}
async function health(release:any){for(let i=0;i<60;i++){try{
  const login=await fetch('http://127.0.0.1:3109/api/trpc/auth.loginByEmployeeId',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({json:{employeeId:'rollback-local-only',password:loginPassword}}),signal:AbortSignal.timeout(1500)});
  const cookie=login.headers.get('set-cookie')?.split(';')[0];if(login.ok&&cookie){const semesters=await fetch('http://127.0.0.1:3109/api/trpc/semesters.list',{headers:{cookie},signal:AbortSignal.timeout(1500)});const data:any=await semesters.json();
  if(data.result?.data?.json?.[0]?.name==='发布回滚虚构学期'){
    if(release.manifest.healthMode==='database'){const response=await fetch('http://127.0.0.1:3109/api/health');const value:any=await response.json();if(response.ok&&value.revision===release.manifest.revision)return true;}
    else{const response=await fetch('http://127.0.0.1:3109/');const bytes=Buffer.from(await response.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')===release.manifest.hashes['dist/public/index.html'])return true;}
  }}
}catch{}if(child?.exitCode!==null)return false;await new Promise(r=>setTimeout(r,100));}return false;}
try{
  await root.query(`CREATE DATABASE \`${database}\``);for(const table of ['users','semesters','courses','course_evaluations','listening_plans','notifications'])await root.query(`CREATE TABLE \`${database}\`.\`${table}\` LIKE zjgsu_preview_20261004.\`${table}\``);
  await root.query(`INSERT INTO \`${database}\`.users (openId,employeeId,name,role,password) VALUES ('rollback-local-only','rollback-local-only','虚构发布验收','admin',?)`,[await hashPassword(loginPassword)]);
  await root.query(`INSERT INTO \`${database}\`.semesters (academicYear,name,startDate,totalWeeks,isActive) VALUES ('2026-2027','发布回滚虚构学期','2026-09-14',18,1)`);
  await root.query(`CREATE USER '${account}'@'127.0.0.1' IDENTIFIED BY ?`,[password]);await root.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON \`${database}\`.* TO '${account}'@'127.0.0.1'`);
  await fs.symlink(old.target,path.join(rootPath,'current'));await restart(old);assert(await health(old),'真实82a3c92旧构建启动、登录、数据库学期读取通过');
  const updated=await activateRelease({root:rootPath,target:next.target,restart,health});assert(updated.revision===newRevision&&await health(next),'新构建真实进程启动与版本健康检查通过');
  assert(await fs.realpath(path.join(rootPath,'previous'))===old.target,'旧版本与旧构建保留');
  await activateRelease({root:rootPath,target:old.target,restart,health});assert(await health(old),'显式代码回滚后旧服务真实登录与数据库查询通过');
  let failed=false;try{await activateRelease({root:rootPath,target:next.target,restart,health:async(release:any)=>release.target===next.target?false:health(release)});}catch(e){failed=(e as Error).message.includes('旧服务健康检查通过');}
  assert(failed&&await fs.realpath(path.join(rootPath,'current'))===old.target&&await health(old),'新版本健康失败自动恢复旧构建和服务');
  const [counts]=await root.query<any[]>(`SELECT (SELECT COUNT(*) FROM \`${database}\`.users) users,(SELECT COUNT(*) FROM \`${database}\`.semesters) semesters`);assert(counts[0].users===1&&counts[0].semesters===1,'发布与回滚未初始化或覆盖数据库');
  assert(!(await fs.stat(path.join(next.target,'node_modules/vite')).catch(()=>null)),'生产依赖安装不含Vite，服务仍能启动');
  await stop();const invalid=spawn(process.execPath,['dist/index.js'],{cwd:next.target,env:{...env,JWT_SECRET:''},stdio:'ignore'});assert((await once(invalid,'exit'))[0]===1,'缺失会话密钥时生产启动失败退出');
  await restart(next);assert(await health(next),'重新启动候选版本健康');
  const occupied=spawn(process.execPath,['dist/index.js'],{cwd:next.target,env,stdio:'ignore'});assert((await once(occupied,'exit'))[0]===1&&await health(next),'端口占用时新进程失败，不改端口或影响原进程');
  const report={passed,database,oldRevision,newRevision,productionDependencies:true,result:'PASS'};await fs.writeFile('tmp/acceptance/release-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await stop();await root.query(`DROP USER IF EXISTS '${account}'@'127.0.0.1'`);await root.end();}
