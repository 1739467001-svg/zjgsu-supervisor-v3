import { describe, expect, it } from "vitest";
import { assertDisposableTestDatabase } from "./test-database-safety";

describe("破坏性数据库测试隔离", () => {
  it.each(["zjgsu_integration_test_a123456789", "zjgsu_test_release_a123456789"])("允许新建隔离库 %s", database => {
    expect(() => assertDisposableTestDatabase(`mysql://test_a123456789:fake@127.0.0.1:3306/${database}`)).not.toThrow();
  });
  it.each(["zjgsu_supervisor", "zjgsu_history_test_a884053914", "zjgsu_preview_20261004", "zjgsu_restore_20261007_a8ee85df6c", "zjgsu_roster_test_87abd0e5cb", "zjgsu_test", "production_test", "zjgsu_test_release_a123456789_extra"])("拒绝对保留库或非专用库清表 %s", database => {
    expect(() => assertDisposableTestDatabase(`mysql://test_a123456789:fake@127.0.0.1:3306/${database}`)).toThrow("拒绝执行");
  });
  it.each([
    "mysql://test_a123456789:fake@db.example.test:3306/zjgsu_test_release_a123456789",
    "mysql://test_a123456789:fake@127.0.0.1.example.test:3306/zjgsu_test_release_a123456789",
    "mysql://test_a123456789:fake@127.0.0.1:13306/zjgsu_test_release_a123456789",
    "mysql://root:fake@127.0.0.1:3306/zjgsu_test_release_a123456789",
    "mysql://test_a123456789:fake@127.0.0.1:3306/zjgsu_test_release_a123456789?host=remote",
    "not-a-connection",
  ])("拒绝远程、转发端口、root和连接覆盖参数", connection => {
    expect(() => assertDisposableTestDatabase(connection)).toThrow("拒绝执行");
  });
  it("拒绝信息不会回显秘密连接", () => {
    try { assertDisposableTestDatabase("mysql://root:do-not-disclose@remote/zjgsu_supervisor"); }
    catch (error) { expect(String(error)).not.toContain("do-not-disclose"); }
  });
});
