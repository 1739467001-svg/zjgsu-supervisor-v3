const EVENT = "supervisor-role-view-changed";
const cache = new Map<number, string>();
const key = (id: number) => `active-role:${id}`;

// 按账号和浏览器标签页隔离；存储不可用时仍可切换。
export function readRoleView(id?: number): string {
  if (id == null || typeof window === "undefined") return "";
  if (cache.has(id)) return cache.get(id)!;
  try { return window.sessionStorage.getItem(key(id)) || ""; } catch { return ""; }
}
export function writeRoleView(id: number, role: string) {
  if (typeof window === "undefined") return;
  cache.set(id, role);
  try { window.sessionStorage.setItem(key(id), role); } catch { /* 保留内存选择 */ }
  window.dispatchEvent(new Event(EVENT));
}
export function subscribeRoleView(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}
