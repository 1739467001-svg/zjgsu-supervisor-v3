// 历史排错工具：此1.6GB生产主机不再运行完整构建，当前部署改用固定便携产物。
// 固定Git发布流程不变，只把构建子步骤日志保存在服务器私有目录。
import { prepareRelease } from '/srv/zjgsu-source-20261014/scripts/release-update.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
let step=0; const runId=Date.now();
await prepareRelease({repo:'/srv/zjgsu-source-20261014',root:'/srv/zjgsu-supervisor-v3',revision:'a9a4b385d4a4800033095825779ccec21db327db',run:async(executable,args,cwd,env)=>{
  const destination=`/root/zjgsu-release-backup-20261014-1040/build-${runId}-step-${++step}.log`;
  const descriptor=fs.openSync(destination,'wx',0o600);
  console.log(`构建步骤${step}开始`);
  const child=spawn(executable,args,{cwd,env,stdio:['ignore',descriptor,descriptor]});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  fs.closeSync(descriptor);
  if(code!==0)throw new Error(`构建步骤${step}失败；只读检查私有日志，原服务不变`);
  console.log(`构建步骤${step}通过`);
  return fs.readFileSync(destination,'utf8');
}});
console.log('固定版本准备通过；尚未切换旧服务');
