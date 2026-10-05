import { describe, it, expect } from "vitest";
import { publicUser } from "./publicUser";

describe("人员字段白名单", () => {
  it("保留角色和学院，不输出密码、联系方式或新增敏感字段", () => {
    const source = { id: 1, name: "测试老师", role: "college_secretary", extraRoles: ["supervisor_expert"], college: "测试学院", password: "test-secret", phone: "test-phone", email: "test-email", remark: "private", identityNumber: "private" };
    const result = publicUser(source as any);
    expect(result).toMatchObject({ id: 1, role: source.role, extraRoles: source.extraRoles, college: source.college });
    for (const field of ["password", "phone", "email", "remark", "identityNumber"]) expect(result).not.toHaveProperty(field);
    expect(source.password).toBe("test-secret");
  });
});
