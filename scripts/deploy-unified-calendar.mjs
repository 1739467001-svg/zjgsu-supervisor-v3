/** 本次已演练的显式校历修订+代码切换；不执行初始化、通用迁移、重置人员或删除课程。 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import mysql from 'mysql2/promise';
const root='/srv/zjgsu-supervisor-v3', service='zjgsu-supervisor-v3.service';
const revision=process.argv[2], oldRevision='a9a4b385d4a4800033095825779ccec21db327db';
if(revision!=='5abdfc8f24f233cfe8531a93b13ffcc5ae846f5e'||process.argv[3]!=='--apply')throw new Error('仅允许本次已验证固定版本，需显式--apply');
const {validateRelease,activateRelease}=await import('/srv/zjgsu-source-20261014/scripts/release-update.mjs');
const target=path.join(root,'releases',revision),old=path.join(root,'releases',oldRevision);
await validateRelease(root,target);await validateRelease(root,old);
if(fs.realpathSync(root+'/current')!==old)throw new Error('当前线上版本发生变化，停止切换');
const folder=path.join('/root/zjgsu-release-backup-20261014-1040/calendar-cloud',`cutover-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomBytes(3).toString('hex')}`);
fs.mkdirSync(folder,{mode:0o700});
const conn=await mysql.createConnection({socketPath:'/var/run/mysqld/mysqld.sock',user:'root',database:'zjgsu_v3_20261016',dateStrings:true});
await conn.query("SET time_zone='+00:00'");
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
const nginxConfig='/etc/nginx/conf.d/zjgsu-v3-ip-stage.conf', originalNginx=fs.readFileSync(nginxConfig,'utf8');
const maintenanceFile='/var/lib/zjgsu-acme/calendar-update.flag';
if(!originalNginx.includes('server {')||fs.existsSync(maintenanceFile))throw new Error('代理配置或发布锁与预期不符，未停止服务');
const maintenanceNginx=originalNginx.replace('server {',`server {\n    if (-f ${maintenanceFile}) { return 503; }`);
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const save=(name,v)=>fs.writeFileSync(path.join(folder,name),JSON.stringify(v,null,2),{mode:0o600,flag:'wx'});
async function snapshot(){const [tables]=await conn.query('SHOW TABLES');const data={};for(const row of tables){const table=String(Object.values(row)[0]);if(!/^[a-z0-9_]+$/.test(table))throw new Error('表名不符');data[table]=(await conn.query(`SELECT * FROM \`${table}\` ORDER BY id`))[0];}return data;}
const health=async release=>{for(let i=0;i<15;i++){try{const r=await fetch('http://127.0.0.1:3010/api/health',{signal:AbortSignal.timeout(2000)});if(r.ok&&(await r.json()).revision===release.manifest.revision)return true;}catch{}await new Promise(r=>setTimeout(r,1000));}return false;};
let before,stopped=false,migrated=false;
try{
 // 切换及回滚演练期间阻止公网业务写入，保留HTTP证书续期配置。
 fs.writeFileSync(maintenanceFile,'calendar update\n',{mode:0o644,flag:'wx'});
 fs.writeFileSync(nginxConfig,maintenanceNginx);run('nginx',['-t']);run('systemctl',['reload','nginx']);
 await new Promise(r=>setTimeout(r,1500));
 run('systemctl',['stop',service]);stopped=true;
 const backup=run(root+'/shared/backup-production.sh',[]).trim();save('backup-path.json',{backup});
 before=await snapshot();save('before.json',before);
 const migration=JSON.parse(run(process.execPath,[path.resolve('align-school-calendar.mjs'),'zjgsu_v3_20261016','/var/run/mysqld/mysqld.sock',path.resolve('mba-original.xls'),'--apply']));migrated=true;save('migration.json',migration);
 const after=await snapshot();save('after.json',after);
 const schoolId=migration.semesterId;
 const stable=(table,rows)=>rows.map(r=>{if(table==='courses'&&r.college==='MBA学院'&&r.semesterId===schoolId){const {weekNumbers,customWeeks,weekType,updatedAt,...other}=r;return other;}if(table==='semesters'&&r.id===schoolId){const {mbaStartDate,mbaTotalWeeks,updatedAt,...other}=r;return other;}return r;});
 for(const table of Object.keys(before))if(digest(stable(table,before[table]))!==digest(stable(table,after[table])))throw new Error('修订范围之外的数据变化，停止并回滚');
 run(process.execPath,[path.resolve('verify-live-course-data.mjs'),path.resolve('standard-original.xls'),path.resolve('mba-original.xls')]);
 // 通用发布器先检查旧服务健康；维护窗口内先启动兼容旧代码，再切换。
 run('systemctl',['start',service]);
 if(!(await health(await validateRelease(root,old))))throw new Error('兼容旧服务未就绪，停止代码切换');
 const result=await activateRelease({root,target,restart:async()=>{run('systemctl',['restart',service]);},health});
 // 同一数据库兼容代码回滚实测；不回退已确认的新校历。
 await activateRelease({root,target:old,restart:async()=>{run('systemctl',['restart',service]);},health});
 await activateRelease({root,target,restart:async()=>{run('systemctl',['restart',service]);},health});
 fs.writeFileSync(nginxConfig,originalNginx);run('nginx',['-t']);run('systemctl',['reload','nginx']);fs.unlinkSync(maintenanceFile);
 const report={revision,previous:oldRevision,backup,folder,migration,verifiedTables:Object.keys(before).length,rollbackRehearsal:'new-old-new health PASS',result:'PASS'};save('result.json',report);console.log(JSON.stringify(report,null,2));
}catch(error){
 save('failure.json',{message:error instanceof Error&&!("sql" in error)?error.message:'内部故障',code:error?.code??null});
 // 服务停止期间无业务写入；仅还原本次允许字段，绝不清表或覆盖其他真实行。
 if(stopped){run('systemctl',['stop',service]);if(migrated&&before){await conn.beginTransaction();try{const term=before.semesters.find(s=>s.isActive);for(const c of before.courses.filter(c=>c.semesterId===term.id&&c.college==='MBA学院'))await conn.query('UPDATE courses SET weekNumbers=?,customWeeks=?,weekType=? WHERE id=?',[typeof c.weekNumbers==='string'?c.weekNumbers:JSON.stringify(c.weekNumbers),c.customWeeks,c.weekType,c.id]);await conn.query('UPDATE semesters SET mbaStartDate=?,mbaTotalWeeks=?,updatedAt=? WHERE id=?',[term.mbaStartDate,term.mbaTotalWeeks,term.updatedAt,term.id]);await conn.commit();}catch(rollbackError){save('rollback-failure.json',{code:rollbackError?.code??null});await conn.rollback();throw new Error('校历字段恢复失败，服务保持停止；请使用本次私有备份核查');}}
 run('systemctl',['start',service]);
 if(fs.realpathSync(root+'/current')!==old)await activateRelease({root,target:old,restart:async()=>{run('systemctl',['restart',service]);},health});}
 console.error('本次发布未完成，已恢复旧版本：'+(error instanceof Error&&!("sql" in error)?error.message:'内部故障，详细资料留存私有目录'));process.exitCode=1;
}finally{fs.writeFileSync(nginxConfig,originalNginx);run('nginx',['-t']);run('systemctl',['reload','nginx']);if(fs.existsSync(maintenanceFile))fs.unlinkSync(maintenanceFile);await conn.end();}
