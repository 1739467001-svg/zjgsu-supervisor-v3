/** 破坏性集成测试专用。恢复库名称虽含test，也绝不能被清表。 */
export function assertDisposableTestDatabase(connection: string): void {
  let url: URL;
  try { url = new URL(connection); } catch { throw new Error("拒绝执行：测试数据库连接格式无效（未输出连接内容）"); }
  if (url.protocol !== "mysql:" || url.hostname !== "127.0.0.1" ||
      (url.port && url.port !== "3306") || url.search || url.hash ||
      !/^\/(?:zjgsu_integration_test|zjgsu_test_release)_[a-f0-9]{10}$/.test(url.pathname) ||
      !/^(?:it|test)_[a-f0-9]{10}$/.test(url.username)) {
    throw new Error("拒绝执行：仅允许本机新建的独立集成/导入测试库及受限临时账号；恢复库、历史兼容库、预览库和生产库均禁止清表");
  }
}
