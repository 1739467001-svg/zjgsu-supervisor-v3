import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { activateRelease, fileHashes, prepareRelease } from "./release-update.mjs";
const roots: string[] = [];
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function fixture() {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'zjgsu-release-')));roots.push(root);
  for(const revision of ['a'.repeat(40),'b'.repeat(40)]) {
    const target=path.join(root,'releases',revision);await fs.mkdir(path.join(target,'dist'),{recursive:true});await fs.mkdir(path.join(target,'node_modules/mysql2'),{recursive:true});
    for(const file of ['package.json','pnpm-lock.yaml','dist/index.js','node_modules/mysql2/package.json'])await fs.writeFile(path.join(target,file),revision);
    await fs.writeFile(path.join(target,'release.env'),`RELEASE_COMMIT=${revision}\n`);
    await fs.writeFile(path.join(target,'release.json'),JSON.stringify({revision,healthMode:'database',hashes:await fileHashes(target)}));
  }
  const old=path.join(root,'releases','a'.repeat(40)),target=path.join(root,'releases','b'.repeat(40));await fs.symlink(old,path.join(root,'current'));return{root,old,target};
}
describe('固定版本代码发布与回退',()=>{
  it('新版本健康检查失败则恢复旧链接并重启旧服务',async()=>{
    const {root,old,target}=await fixture(),restart=vi.fn().mockResolvedValue(undefined),health=vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(activateRelease({root,target,restart,health})).rejects.toThrow(/旧服务健康检查通过/);
    expect(await fs.realpath(path.join(root,'current'))).toBe(old);expect(restart).toHaveBeenCalledTimes(2);
  });
  it('构建产物被修改时不切换、不重启服务',async()=>{
    const {root,old,target}=await fixture(),restart=vi.fn();await fs.writeFile(path.join(target,'dist/index.js'),'changed');
    await expect(activateRelease({root,target,restart,health:async()=>true})).rejects.toThrow(/校验失败/);
    expect(await fs.realpath(path.join(root,'current'))).toBe(old);expect(restart).not.toHaveBeenCalled();
  });
  it('成功更新保留previous和旧构建，重复更新拒绝',async()=>{
    const {root,old,target}=await fixture(),restart=vi.fn().mockResolvedValue(undefined),health=async()=>true;
    await activateRelease({root,target,restart,health});expect(await fs.realpath(path.join(root,'previous'))).toBe(old);expect(await fs.readFile(path.join(old,'dist/index.js'),'utf8')).toBe('a'.repeat(40));
    await expect(activateRelease({root,target,restart,health})).rejects.toThrow(/已经是目标版本/);
  });
  it.each(['install','build'])('%s失败时旧链接及构建不改变，准备步骤没有服务重启',async phase=>{
    const {root,old}=await fixture();
    const repo=path.resolve(import.meta.dirname,'..'),revision='82a3c929118fdd7c3c4bc91f111f822361a13775';
    const run=vi.fn(async(executable:string,args:string[])=>{if(executable==='git')return args[0]==='status'?'':revision;if(args[0]===phase)throw new Error('injected preparation failure');return '';});
    await expect(prepareRelease({repo,root,revision,run})).rejects.toThrow(/未重启/);
    expect(await fs.realpath(path.join(root,'current'))).toBe(old);expect(run.mock.calls.every(call=>call[0]!=='systemctl')).toBe(true);
    expect(run.mock.calls.some(call=>call[0]==='pnpm'&&call[1][0]===phase)).toBe(true);
    expect(await fs.readFile(path.join(old,'dist/index.js'),'utf8')).toBe('a'.repeat(40));
  });
  it('已有发布锁时拒绝第二个更新',async()=>{
    const {root,target}=await fixture(),restart=vi.fn();await fs.mkdir(path.join(root,'.release-lock'));
    await expect(activateRelease({root,target,restart,health:async()=>true})).rejects.toThrow();expect(restart).not.toHaveBeenCalled();
  });
});
