import { TRPCError } from "@trpc/server";
const attempts = new Map<string, { count: number; expires: number }>();
const WINDOW = 15 * 60 * 1000;
export function checkLoginThrottle(account: string, ip: string) {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.expires <= now) attempts.delete(key);
  for (const [key, limit] of [[`account:${account}`, 10], [`ip:${ip}`, 60]] as const) {
    const entry = attempts.get(key) || { count: 0, expires: now + WINDOW };
    if (entry.count >= limit || attempts.size >= 10000) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "登录尝试过多，请稍后再试" });
    entry.count++;
    attempts.set(key, entry);
  }
}
export function clearAccountLoginThrottle(account: string) { attempts.delete(`account:${account}`); }
