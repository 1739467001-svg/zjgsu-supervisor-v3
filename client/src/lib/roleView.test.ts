import { afterEach, describe, expect, it, vi } from "vitest";
import { readRoleView, writeRoleView, subscribeRoleView } from "./roleView";
afterEach(() => vi.unstubAllGlobals());
describe("身份视图同步", () => {
  it("通知侧栏及工作台，隔离账号，解绑后不再通知", () => {
    vi.stubGlobal("window", Object.assign(new EventTarget(), { sessionStorage: { getItem: () => null, setItem: vi.fn() } }));
    const a = vi.fn(); const b = vi.fn();
    const stopA = subscribeRoleView(a); const stopB = subscribeRoleView(b);
    writeRoleView(90001, "college_secretary");
    expect(readRoleView(90001)).toBe("college_secretary");
    expect(readRoleView(90002)).toBe("");
    expect(a).toHaveBeenCalledOnce(); expect(b).toHaveBeenCalledOnce();
    stopA(); stopB();
    writeRoleView(90001, "supervisor_expert");
    expect(a).toHaveBeenCalledOnce();
  });
  it("禁用存储时仍可切换", () => {
    vi.stubGlobal("window", Object.assign(new EventTarget(), { sessionStorage: { getItem: () => { throw Error(); }, setItem: () => { throw Error(); } } }));
    expect(readRoleView(90003)).toBe("");
    writeRoleView(90003, "supervisor_expert");
    expect(readRoleView(90003)).toBe("supervisor_expert");
  });
});
