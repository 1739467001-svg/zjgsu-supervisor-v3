import { describe, expect, it } from "vitest";
import { systemRouter } from "./_core/systemRouter";
describe("系统管理员辅助接口的初始密码门禁",()=>{
  it("技术管理员也必须先改初始密码，不能绕过业务门禁",async()=>{
    const caller=systemRouter.createCaller({user:{id:1,role:"admin",employeeId:"test-admin",password:"scrypt-reset$fixture"},req:{},res:{}} as any);
    await expect(caller.notifyOwner({title:"测试",content:"测试"})).rejects.toMatchObject({code:"FORBIDDEN"});
  });
});
