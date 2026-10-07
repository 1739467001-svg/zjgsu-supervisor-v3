import { describe, expect, it } from "vitest";
import { getSessionCookieOptions } from "./_core/cookies";
describe("代理与会话Cookie", () => {
  it("客户端伪造代理头不能改变HTTP会话属性", () => {
    expect(getSessionCookieOptions({ protocol: "http", headers: { "x-forwarded-proto": "https" } } as any)).toMatchObject({ secure: false, sameSite: "lax", httpOnly: true });
  });
  it("经Express信任代理处理的HTTPS使用安全Cookie", () => {
    expect(getSessionCookieOptions({ protocol: "https", headers: {} } as any)).toMatchObject({ secure: true, sameSite: "none", httpOnly: true });
  });
});
