import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, isPasswordResetRequired, credentialVersion, validateNewPassword } from "./passwords";

describe("密码安全与旧账号兼容", () => {
  it("相同密码每次使用不同盐，正确密码可验证，错误密码不可验证", async () => {
    const first = await hashPassword("Example-Password-2026");
    const second = await hashPassword("Example-Password-2026");
    expect(first).not.toBe(second);
    expect(first).not.toContain("Example-Password-2026");
    expect(await verifyPassword("Example-Password-2026", first)).toBe(true);
    expect(await verifyPassword("wrong", first)).toBe(false);
  });
  it("兼容旧密码，但禁用账号和损坏的哈希不可登录", async () => {
    expect(await verifyPassword("legacy", "legacy")).toBe(true);
    expect(await verifyPassword("1234567", null, "1234567")).toBe(true);
    expect(await verifyPassword("1234567", "disabled$123", "1234567")).toBe(false);
    expect(await verifyPassword("anything", "scrypt$invalid$invalid")).toBe(false);
  });
  it("临时密码标记强制修改，修改凭据使会话版本失效", async () => {
    const temporary = await hashPassword("Temporary-2026", true);
    expect(isPasswordResetRequired(temporary)).toBe(true);
    expect(await verifyPassword("Temporary-2026", temporary)).toBe(true);
    expect(credentialVersion("account", temporary, "test-secret")).not.toBe(credentialVersion("account", "changed", "test-secret"));
    expect(credentialVersion("account", temporary, "test-secret")).not.toBe(credentialVersion("other", temporary, "test-secret"));
  });
  it("拒绝短密码、纯字母和工号原样密码", () => {
    for (const value of ["short1", "onlylettershere", "1234567890"]) expect(() => validateNewPassword(value, "1234567890")).toThrow();
    expect(() => validateNewPassword("Strong-2026-password")).not.toThrow();
  });
});
