/** 仅恢复本次切换窗口内的私有备份到全新独立库，与窗口快照全部9表核对。 */
import mysql from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
const folder=path.resolve(process.argv[2]||'');
if(!/^\/root\/zjgsu-release-backup-20261014-1040\/calendar-cloud\/cutover-[a-zA-Z0-9.-]+$/.test(folder))throw new Error('只接受本次校历切换私有记录目录');
const {backup}=JSON.parse(fs.readFileSync(path.join(folder,'backup-path.json')));
if(!/^\/srv\/zjgsu-supervisor-v3\/backups\/[a-zA-Z0-9-]+$/.test(backup))throw new Error('备份路径不符');
const before=JSON.parse(fs.readFileSync(path.join(folder,'before.json')));
const database=`zjgsu_restore_calendar_${randomBytes(5).toString('hex')}`;
const c=await mysql.createConnection({socketPath:'/var/run/mysqld/mysqld.sock',user:'root',dateStrings:true});
try{
 await c.query("SET time_zone='+00:00'");await c.query(`CREATE DATABASE \`${database}\``);
 const gzip=spawn('gzip',['-dc',path.join(backup,'database.sql.gz')],{stdio:['ignore','pipe','pipe']});
 const restore=spawn('mysql',['--socket=/var/run/mysqld/mysqld.sock','-u','root',database],{stdio:['pipe','ignore','pipe']});
 gzip.stderr.on('data',()=>{});restore.stderr.on('data',()=>{});gzip.stdout.pipe(restore.stdin);
 const wait=child=>new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code));});
 const codes=await Promise.all([wait(gzip),wait(restore)]);if(codes.some(code=>code!==0))throw new Error('独立备份恢复未完成，原备份未改动');
 const hash=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');const tables={};
 for(const [table,expected] of Object.entries(before)){
  if(!/^[a-z0-9_]+$/.test(table))throw new Error('表名不符');
  const [actual]=await c.query(`SELECT * FROM \`${database}\`.\`${table}\` ORDER BY id`);
  if(hash(actual)!==hash(expected))throw new Error('备份实际恢复后的逐行散列不一致：'+table);
  tables[table]={rows:actual.length,sha256:hash(actual)};
 }
 const report={database,backup,verifiedTables:Object.keys(tables).length,tables,result:'PASS'};fs.writeFileSync(path.join(folder,'backup-restore.json'),JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify({database,verifiedTables:report.verifiedTables,result:'PASS'}));
}catch(error){console.error(error instanceof Error&&!("sql" in error)?error.message:'恢复核验失败，未输出内部SQL或凭据');process.exitCode=1;}
finally{await c.end();}
