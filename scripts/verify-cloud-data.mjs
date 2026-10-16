/** 对账只读；仅输出表计数/散列，比较完整记录而非文件存在。 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
const remote=process.argv.includes('--remote');
const require=createRequire(remote?'/srv/zjgsu-supervisor-v3/releases/a9a4b385d4a4800033095825779ccec21db327db/package.json':new URL('../package.json',import.meta.url));
const mysql=require('mysql2/promise');
const connection=await mysql.createConnection({socketPath:remote?'/var/run/mysqld/mysqld.sock':'/tmp/mysql.sock',user:'root',dateStrings:true});
await connection.query("SET time_zone='+00:00'");
const snapshot=async(database)=>{
  if(!/^[a-z0-9_]+$/.test(database))throw new Error('数据库名不符合对账要求');
  const [tables]=await connection.query(`SHOW TABLES FROM \`${database}\``);const result={};
  for(const row of tables){const table=String(Object.values(row)[0]);if(!/^[a-z0-9_]+$/.test(table))throw new Error('表名不符合对账要求');
    const [records]=await connection.query(`SELECT * FROM \`${database}\`.\`${table}\` ORDER BY id`);
    result[table]={rows:records.length,sha256:createHash('sha256').update(JSON.stringify(records)).digest('hex')};
  }return result;
};
try {
  const candidate=await snapshot(remote&&process.argv.includes('--production')?'zjgsu_v3_20261016':'zjgsu_history_test_c8446e847c');
  const original=await snapshot(remote?'zjgsu_supervisor':'zjgsu_restore_20261007_09a71e21a1');
  if(!remote){fs.writeFileSync('tmp/acceptance/cloud-20261014/expected-data.json',JSON.stringify({candidate,original},null,2));console.log('本地源库及候选全表散列清单已生成');}
  else {
    const expected=JSON.parse(fs.readFileSync('/root/zjgsu-release-backup-20261014-1040/expected-data.json','utf8'));
    const equal=(a,b)=>Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>a[k].rows===b[k]?.rows&&a[k].sha256===b[k]?.sha256);
    const report={candidateIdentical:equal(candidate,expected.candidate),liveSourceUnchanged:equal(original,expected.original),tables:candidate};
    fs.writeFileSync('/root/zjgsu-release-backup-20261014-1040/'+(process.argv.includes('--production')?'server-production-data-report.json':'server-data-report.json'),JSON.stringify(report,null,2),{mode:0o600});
    console.log(JSON.stringify({candidateIdentical:report.candidateIdentical,liveSourceUnchanged:report.liveSourceUnchanged,tables:Object.keys(candidate).length}));
    if(!report.candidateIdentical||!report.liveSourceUnchanged)throw new Error('数据发生变化，停止切换，需重新对账');
  }
}finally{await connection.end();}
