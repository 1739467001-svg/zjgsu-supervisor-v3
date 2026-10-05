import type { User } from "../drizzle/schema";

/** 浏览器可见人员字段白名单；新增数据库字段不会自动暴露。 */
export function publicUser(user: User) {
  return {
    id: user.id, openId: user.openId, name: user.name,
    employeeId: user.employeeId, role: user.role, extraRoles: user.extraRoles,
    college: user.college, supervisorScope: user.supervisorScope,
    createdAt: user.createdAt, updatedAt: user.updatedAt, lastSignedIn: user.lastSignedIn,
  };
}
