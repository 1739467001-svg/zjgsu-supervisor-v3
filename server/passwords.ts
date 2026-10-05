import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
const scrypt = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scryptCallback(password, salt, 64, { N: COST, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, derived) => error ? reject(error) : resolve(derived));
});
const COST = 32768;
export const isPasswordHash = (value?: string | null) => /^scrypt(?:-reset)?\$/.test(value || "");
export const isPasswordResetRequired = (value?: string | null) => value?.startsWith("scrypt-reset$") ?? false;
export const isAccountDisabled = (value?: string | null) => value?.startsWith("disabled$") ?? false;

export async function hashPassword(password: string, forceChange = false): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt);
  return `${forceChange ? "scrypt-reset" : "scrypt"}$${salt}$${derived.toString("hex")}`;
}

/** 验证旧密码只用于成功登录时的逐账号升级。 */
export async function verifyPassword(password: string, stored: string | null | undefined, employeeId = ""): Promise<boolean> {
  if (isAccountDisabled(stored)) return false;
  if (isPasswordHash(stored)) {
    const parts = stored!.split("$");
    if (parts.length !== 3 || !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{128}$/.test(parts[2])) return false;
    const actual = await scrypt(password, parts[1]);
    return timingSafeEqual(actual, Buffer.from(parts[2], "hex"));
  }
  const expected = Buffer.from(stored || employeeId);
  const supplied = Buffer.from(password);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function credentialVersion(openId: string, password: string | null | undefined, secret: string): string {
  return createHmac("sha256", secret).update(openId).update("\0").update(password || "").digest("hex");
}

export function validateNewPassword(password: string, employeeId?: string | null) {
  if (password.length < 10 || password.length > 128 || !/[A-Za-z]/.test(password) || !/[^A-Za-z]/.test(password) || password === employeeId) {
    throw new Error("新密码须为 10—128 位，包含字母及数字或符号，且不能与工号相同");
  }
}
