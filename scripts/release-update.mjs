/** 固定版本、保留旧构建的代码发布；绝不迁移、初始化、导课表或恢复数据库。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const shaPattern = /^[a-f0-9]{40}$/;
export async function fileHashes(directory) {
  const files = ['package.json', 'pnpm-lock.yaml'];
  async function walk(relative) { for (const entry of await fs.readdir(path.join(directory,relative),{withFileTypes:true})) { const name=path.posix.join(relative,entry.name); if(entry.isDirectory())await walk(name); else if(entry.isFile())files.push(name); else throw new Error('构建中存在未经允许的链接'); } }
  await walk('dist'); const hashes={};for(const file of files.sort())hashes[file]=digest(await fs.readFile(path.join(directory,file)));return hashes;
}
export async function validateRelease(root, target) {
  const releases=await fs.realpath(path.join(root,'releases')), real=await fs.realpath(target);
  if(path.dirname(real)!==releases||!shaPattern.test(path.basename(real)))throw new Error('发布目标不是本系统的固定版本目录');
  const manifest=JSON.parse(await fs.readFile(path.join(real,'release.json'),'utf8'));
  if(manifest.revision!==path.basename(real)||!['database','legacy'].includes(manifest.healthMode))throw new Error('发布版本信息不符');
  const actual=await fileHashes(real);
  if(JSON.stringify(actual)!==JSON.stringify(manifest.hashes))throw new Error('发布文件校验失败');
  await fs.access(path.join(real,'node_modules/mysql2/package.json'));
  const env=await fs.readFile(path.join(real,'release.env'),'utf8');
  if(env!==`RELEASE_COMMIT=${manifest.revision}\n`)throw new Error('运行版本配置不符');
  return { target:real,manifest };
}
async function atomicLink(root, name, target) {
  const temporary=path.join(root,`.${name}-${randomBytes(6).toString('hex')}`);
  await fs.symlink(target,temporary);try{await fs.rename(temporary,path.join(root,name));}finally{await fs.rm(temporary,{force:true});}
}
export async function activateRelease({root,target,restart,health}) {
  await fs.mkdir(root,{recursive:true});const lock=path.join(root,'.release-lock');await fs.mkdir(lock);
  try {
    if(!(await fs.lstat(path.join(root,'current'))).isSymbolicLink())throw new Error('已有系统必须先保留原目录和构建，并采用current链接；不覆盖真实目录');
    const old=await validateRelease(root,await fs.realpath(path.join(root,'current'))),next=await validateRelease(root,target);
    if(old.target===next.target)throw new Error('已经是目标版本');
    if(!(await health(old)))throw new Error('旧服务健康状态不明，停止更新');
    await atomicLink(root,'previous',old.target);
    await atomicLink(root,'current',next.target);
    try {await restart(next);if(!(await health(next)))throw new Error('新版本健康检查失败');}
    catch {
      await atomicLink(root,'current',old.target);
      try{await restart(old);if(!(await health(old)))throw new Error('unhealthy');}
      catch{throw new Error('新版本失败，旧构建已恢复但服务健康检查仍失败，需要人工处理；数据库未恢复或覆盖');}
      throw new Error('新版本失败，已恢复旧代码与构建，旧服务健康检查通过；数据库未恢复或覆盖');
    }
    return {revision:next.manifest.revision,previous:old.manifest.revision};
  } finally {await fs.rmdir(lock);}
}
async function command(executable,args,cwd,env=process.env) {
  const child=spawn(executable,args,{cwd,env,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const code=(await once(child,'exit'))[0];if(code!==0)throw new Error('发布命令未完成，服务未切换（未输出命令日志或配置）');return output;
}
export async function prepareRelease({repo,root,revision,run=command}) {
  if(!shaPattern.test(revision||''))throw new Error('必须提供40位完整提交号');
  const version=process.versions.node.split('.').map(Number);if(version[0]<22||(version[0]===22&&version[1]<12))throw new Error('发布构建要求Node 22.12或以上；上线前固定目标主版本');
  if((await run('git',['rev-parse',`${revision}^{commit}`],repo)).trim()!==revision)throw new Error('提交不存在');
  if((await run('git',['status','--porcelain'],repo)).trim())throw new Error('源码工作区有改动，需先核实并提交，不能用工作区冒充固定版本');
  await fs.mkdir(path.join(root,'releases'),{recursive:true});
  const stage=path.join(root,`.prepare-${revision}-${randomBytes(4).toString('hex')}`),target=path.join(root,'releases',revision);
  try{await fs.lstat(target);throw new Error('同名发布版本已存在，拒绝覆盖');}catch(e){if(e.code!=='ENOENT')throw e;}
  await fs.mkdir(stage); const source=spawn('git',['archive',revision],{cwd:repo,stdio:['ignore','pipe','ignore']});const extract=spawn('tar',['xf','-','-C',stage],{stdio:['pipe','ignore','ignore']});source.stdout.pipe(extract.stdin);
  const exits=await Promise.all([once(source,'exit'),once(extract,'exit')]);if(exits.some(r=>r[0]!==0))throw new Error('源码归档失败，服务未切换');
  // .env 不存在于git归档；构建不加载生产环境。安装/构建失败不触碰current与服务。
  const cleanEnv={...process.env,DOTENV_CONFIG_PATH:'/dev/null',NODE_ENV:'development',CI:'true'};for(const key of Object.keys(cleanEnv))if(/SECRET|PASSWORD|DATABASE_URL|API_KEY|TOKEN/.test(key))delete cleanEnv[key];
  try {
    await run('pnpm',['install','--frozen-lockfile'],stage,cleanEnv);
    await run('pnpm',['check'],stage,cleanEnv);await run('pnpm',['build'],stage,cleanEnv);
    await run('pnpm',['install','--prod','--frozen-lockfile'],stage,{...cleanEnv,NODE_ENV:'production'});
    const manifest={revision,healthMode:(await fs.readFile(path.join(stage,'server/_core/index.ts'),'utf8')).includes('"/api/health"')?'database':'legacy',node:process.version,platform:process.platform,arch:process.arch,packageManager:JSON.parse(await fs.readFile(path.join(stage,'package.json'),'utf8')).packageManager,hashes:await fileHashes(stage)};
    await fs.writeFile(path.join(stage,'release.json'),JSON.stringify(manifest,null,2),{mode:0o600});await fs.writeFile(path.join(stage,'release.env'),`RELEASE_COMMIT=${revision}\n`,{mode:0o600});
    await fs.rename(stage,target);return {target,manifest};
  }catch{throw new Error('依赖安装、类型检查或构建失败，旧服务未切换、未重启；准备目录保留供核查');}
}
async function cli() {
  const [action,...argv]=process.argv.slice(2),options={};for(let i=0;i<argv.length;i+=2)options[argv[i]]=argv[i+1];
  const root=path.resolve(options['--root']||''),repo=options['--repo'],revision=options['--revision'];
  if(!options['--root'])throw new Error('需要独立发布根目录--root');
  if(action==='prepare'){if(!repo)throw new Error('需要源码仓库--repo');const prepared=await prepareRelease({repo,root,revision});console.log(`已准备固定版本 ${prepared.manifest.revision}；未启用服务`);return;}
  if(!['activate','rollback'].includes(action))throw new Error('用法：prepare/activate/rollback --root 路径；prepare指定--repo及--revision');
  const service=options['--service'];if(!/^[a-zA-Z0-9_-]+\.service$/.test(service||''))throw new Error('需要准确的systemd服务名');
  const port=Number(options['--port']||3000);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('端口无效');
  const health=async release=>{
    for(let i=0;i<15;i++){
      try{
        if(release.manifest.healthMode==='database'){const response=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(2000)});const data=await response.json();if(response.ok&&data.status==='ok'&&data.revision===release.manifest.revision)return true;}
        else {const response=await fetch(`http://127.0.0.1:${port}/api/trpc/system.health?input=${encodeURIComponent(JSON.stringify({json:{timestamp:1}}))}`,{signal:AbortSignal.timeout(2000)});const data=await response.json();const page=await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(2000)});const html=Buffer.from(await page.arrayBuffer());if(response.ok&&data.result?.data?.json?.ok&&digest(html)===release.manifest.hashes['dist/public/index.html']){const require=createRequire(path.join(release.target,'package.json'));const dotenv=require('dotenv'),mysql=require('mysql2/promise');const config=dotenv.parse(await fs.readFile(path.join(root,'shared/runtime.env')));const conn=await mysql.createConnection(config.DATABASE_URL);try{await conn.query('SELECT 1');return true;}finally{await conn.end();}}}
      }catch{}await new Promise(r=>setTimeout(r,1000));
    }return false;
  };
  const target=action==='rollback'?await fs.realpath(path.join(root,'previous')):path.join(root,'releases',revision||'');
  const result=await activateRelease({root,target,restart:async()=>{await command('systemctl',['restart',service],root);},health});console.log(`已启用 ${result.revision}；上一版本 ${result.previous}`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)cli().catch(e=>{console.error(e.message);process.exitCode=1;});
