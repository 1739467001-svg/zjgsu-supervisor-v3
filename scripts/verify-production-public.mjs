/** 公网只做登录和读取/门禁检查，不改密码、不写评价；账号信息只在内存中使用。 */
import mysql from 'mysql2/promise';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const origin='https://121.196.217.243', revision='a9a4b385d4a4800033095825779ccec21db327db';
let passed=0;
const assert=(ok,label)=>{if(!ok)throw new Error(label);passed++;};
const conn=await mysql.createConnection({socketPath:'/var/run/mysqld/mysqld.sock',user:'root',database:'zjgsu_v3_20261016'});
try {
  const response=await fetch(origin+'/api/health');
  assert(response.ok&&(await response.json()).revision===revision,'公网健康及版本');
  assert(response.headers.get('x-content-type-options')==='nosniff','安全响应头');
  const redirect=await fetch('http://121.196.217.243/login',{redirect:'manual'});
  assert(redirect.status===301&&redirect.headers.get('location')===origin+'/login','HTTP跳转HTTPS');
  const page=await fetch(origin+'/login'), html=await page.text();
  assert(page.ok&&html.includes('root'),'登录页HTML');
  const manifest=JSON.parse(fs.readFileSync('/srv/zjgsu-supervisor-v3/current/release.json','utf8'));
  const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^"\s]+)"/g)].map(m=>m[1]);
  assert(assets.length>=2,'页面绑定JS和CSS');
  for(const asset of assets){const r=await fetch(origin+asset), bytes=Buffer.from(await r.arrayBuffer());assert(r.ok&&createHash('sha256').update(bytes).digest('hex')===manifest.hashes['dist/public'+asset],'公网静态产物与冻结版本一致');}
  const [users]=await conn.query("SELECT employeeId FROM users WHERE role='graduate_admin' AND employeeId IS NOT NULL ORDER BY id LIMIT 1");
  const id=users[0]?.employeeId;assert(!!id,'正式主管存在');
  const login=await fetch(origin+'/api/trpc/auth.loginByEmployeeId',{method:'POST',headers:{'content-type':'application/json','x-forwarded-proto':'http','x-forwarded-for':'198.51.100.99'},body:JSON.stringify({json:{employeeId:id,password:id}})});
  const result=await login.json(), cookie=login.headers.get('set-cookie')||'', user=result.result?.data?.json?.user;
  assert(login.ok&&user?.passwordChangeRequired,'正式初始账号登录且要求改密');
  assert(/;\s*Secure/i.test(cookie)&&/;\s*HttpOnly/i.test(cookie),'Secure/HttpOnly Cookie与转发协议防伪');
  assert(user&&!['password','phone','email','identityNumber'].some(k=>k in user),'用户接口无敏感字段');
  const headers={cookie:cookie.split(';')[0]};
  assert((await fetch(origin+'/api/trpc/auth.me',{headers})).ok,'HTTPS会话可识别');
  assert((await fetch(origin+'/api/trpc/semesters.list',{headers})).status===403,'初始密码不能绕过业务门禁');
  assert((await fetch(origin+'/api/trpc/semesters.list')).status===401,'未登录业务拒绝');
  const attempts=await Promise.all(Array.from({length:18},()=>fetch(origin+'/api/trpc/auth.loginByEmployeeId',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':`198.51.100.${Math.floor(Math.random()*200)+1}`},body:JSON.stringify({json:{employeeId:'deployment-limit-check',password:'invalid-test-only'}})})));
  assert(attempts.some(r=>r.status===429&&r.headers.get('content-type')?.includes('text/html')),'公网nginx真实登录限流，伪造来源不能绕过');
  const [terms]=await conn.query('SELECT s.academicYear,s.name,s.isActive,COUNT(DISTINCT c.id) courses,COUNT(DISTINCT e.id) evaluations FROM semesters s LEFT JOIN courses c ON c.semesterId=s.id LEFT JOIN course_evaluations e ON e.semesterId=s.id GROUP BY s.id ORDER BY s.id');
  assert(terms.length===2&&terms[0].courses===2269&&terms[0].evaluations===81&&terms[1].courses===1832,'历史和新学期数据留存');
  const [orphans]=await conn.query('SELECT COUNT(*) n FROM course_evaluations e LEFT JOIN courses c ON c.id=e.courseId LEFT JOIN users u ON u.id=e.supervisorId WHERE c.id IS NULL OR u.id IS NULL');
  assert(orphans[0].n===0,'评价课程和作者关联完整');
  const report={revision,passed,terms,result:'PASS',note:'只登录一个主管账号，正常触发密码哈希升级/登录时间；未改密码、未创建评价；完整业务1970项在云端独立克隆验证。'};
  fs.writeFileSync('/root/zjgsu-release-backup-20261014-1040/public-acceptance-20261016.json',JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify({revision,passed,result:'PASS'}));
}catch(error){console.error('公网验收未通过：'+(error instanceof Error&&!("sql" in error)?error.message:'数据库检查失败，未输出敏感内容'));process.exitCode=1;}
finally{await conn.end();}
