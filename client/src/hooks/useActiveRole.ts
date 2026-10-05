import { useCallback, useSyncExternalStore } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getEffectiveRoles } from "@shared/roles";
import { readRoleView, subscribeRoleView, writeRoleView } from "@/lib/roleView";

/** 切换工作台视图；导航和服务端权限始终取完整授权集合。 */
export function useActiveRole() {
  const { user } = useAuth();
  const effectiveRoles = getEffectiveRoles(user);
  const selected = useSyncExternalStore(subscribeRoleView, () => readRoleView(user?.id), () => "");
  const activeRole = user
    ? (effectiveRoles.includes(selected) ? selected : user.role || effectiveRoles[0] || "user")
    : "user";
  const setActiveRole = useCallback((role: string) => {
    if (user && getEffectiveRoles(user).includes(role)) writeRoleView(user.id, role);
  }, [user]);
  return { activeRole, setActiveRole, effectiveRoles, canSwitch: effectiveRoles.length > 1 };
}
