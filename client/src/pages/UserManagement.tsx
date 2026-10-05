import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Search, Users, Shield, GraduationCap, Building2, User, Settings2 } from "lucide-react";
import { ASSIGNABLE_ROLES, getSupervisorScopeLabel, normalizeExtraRoles, type SupervisorScope } from "@shared/roles";

const ROLE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  supervisor_expert: { label: "督导专家", icon: <GraduationCap className="w-3.5 h-3.5" />, color: "oklch(0.35 0.13 245)", bg: "oklch(0.93 0.018 240)" },
  supervisor_leader: { label: "督导组长", icon: <Shield className="w-3.5 h-3.5" />, color: "oklch(0.42 0.14 160)", bg: "oklch(0.93 0.018 160)" },
  college_secretary: { label: "学院教学秘书", icon: <Building2 className="w-3.5 h-3.5" />, color: "oklch(0.55 0.14 85)", bg: "oklch(0.95 0.02 85)" },
  graduate_admin: { label: "研究生院主管", icon: <Users className="w-3.5 h-3.5" />, color: "oklch(0.55 0.14 300)", bg: "oklch(0.95 0.02 300)" },
  admin: { label: "系统管理员", icon: <Shield className="w-3.5 h-3.5" />, color: "oklch(0.55 0.14 30)", bg: "oklch(0.95 0.02 30)" },
};

const SUPERVISOR_ROLES = ["supervisor_expert", "supervisor_leader"];

export default function UserManagement() {
  const [search, setSearch] = useState("");
  const [accountDialog, setAccountDialog] = useState<{ mode: "create" | "reset" | "activate"; userId?: number; name: string; employeeId: string } | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [newRole, setNewRole] = useState<(typeof ASSIGNABLE_ROLES)[number]>("supervisor_expert");
  const [newCollege, setNewCollege] = useState("");
  const [newScope, setNewScope] = useState<SupervisorScope>("college");
  const [roleFilter, setRoleFilter] = useState("all");
  const [editDialog, setEditDialog] = useState<{
    open: boolean;
    userId?: number;
    name?: string;
    role?: (typeof ASSIGNABLE_ROLES)[number];
    extraRoles: string[];
    college: string;
    supervisorScope: SupervisorScope;
  }>({
    open: false,
    extraRoles: [],
    college: "",
    supervisorScope: "school",
  });
  const utils = trpc.useUtils();

  const { data: users, isLoading } = trpc.users.list.useQuery();

  const updateRoleMutation = trpc.users.updateRole.useMutation({
    onSuccess: () => {
      toast.success("角色已更新");
      utils.users.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateExtraRolesMutation = trpc.users.updateExtraRoles.useMutation({
    onError: (err) => toast.error(err.message),
  });
  const accountSuccess = () => {
    toast.success("账号已更新"); setAccountDialog(null); setTemporaryPassword(""); utils.users.list.invalidate();
  };
  const createAccount = trpc.users.create.useMutation({ onSuccess: accountSuccess, onError: err => toast.error(err.message) });
  const resetPassword = trpc.users.resetPassword.useMutation({ onSuccess: accountSuccess, onError: err => toast.error(err.message) });
  const activateAccount = trpc.users.activate.useMutation({ onSuccess: accountSuccess, onError: err => toast.error(err.message) });
  const disableAccount = trpc.users.disable.useMutation({ onSuccess: () => { toast.success("账号已停用，历史记录保留"); utils.users.list.invalidate(); }, onError: err => toast.error(err.message) });
  const updateProfile = trpc.users.updateProfile.useMutation({ onError: err => toast.error(err.message) });

  const updateCollegeMutation = trpc.users.updateCollege.useMutation({
    onError: (err) => toast.error(err.message),
  });

  const updateScopeMutation = trpc.users.updateSupervisorScope.useMutation({
    onError: (err) => toast.error(err.message),
  });

  const openEditDialog = (u: NonNullable<typeof users>[number]) => {
    setEditDialog({
      open: true,
      userId: u.id,
      name: u.name || "",
      role: u.role as (typeof ASSIGNABLE_ROLES)[number],
      extraRoles: normalizeExtraRoles((u as any).extraRoles),
      college: u.college || "",
      supervisorScope: (u as any).supervisorScope === "college" ? "college" : "school",
    });
  };

  const toggleExtraRole = (role: string, checked: boolean) => {
    setEditDialog((prev) => ({
      ...prev,
      extraRoles: checked ? Array.from(new Set([...prev.extraRoles, role])) : prev.extraRoles.filter((r) => r !== role),
    }));
  };

  const handleSaveEdit = async () => {
    if (!editDialog.userId) return;
    try {
      const college = editDialog.college.trim() || null;
      if (editDialog.supervisorScope === "college" && !college) {
        toast.error("请填写所属学院，院级范围不能自动改为校级");
        return;
      }
      const scope: SupervisorScope = editDialog.supervisorScope;
      await updateProfile.mutateAsync({ userId: editDialog.userId, role: editDialog.role!, extraRoles: editDialog.extraRoles as any, college, supervisorScope: scope });
      if (scope !== editDialog.supervisorScope) {
        toast.success("已保存（未填学院，督导范围按校级处理）");
      } else {
        toast.success("已保存");
      }
      utils.users.list.invalidate();
      setEditDialog({ open: false, extraRoles: [], college: "", supervisorScope: "school" });
    } catch (err: any) {
      toast.error(err.message || "保存失败");
    }
  };

  const filtered = users?.filter((u) => {
    const matchSearch = !search || u.name?.includes(search) || u.employeeId?.includes(search) || u.college?.includes(search);
    const matchRole = roleFilter === "all" || u.role === roleFilter;
    return matchSearch && matchRole;
  }) || [];

  const roleCounts = users?.reduce((acc, u) => {
    acc[u.role || "user"] = (acc[u.role || "user"] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-5 page-transition">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "oklch(0.18 0.025 240)" }}>用户管理</h1>
          <p className="text-sm mt-0.5" style={{ color: "oklch(0.52 0.025 240)" }}>管理系统用户角色与权限</p>
          <Button className="mt-3" onClick={() => { setTemporaryPassword(""); setNewCollege(""); setAccountDialog({ mode: "create", name: "", employeeId: "" }); }}>新增用户</Button>
        </div>

        {/* 角色统计 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(ROLE_CONFIG).filter(([k]) => k !== "user" && k !== "admin").map(([role, config]) => (
            <div key={role} className="bg-white rounded-xl p-4" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: config.bg, color: config.color }}>
                  {config.icon}
                </div>
              </div>
              <div className="text-xl font-bold" style={{ color: "oklch(0.18 0.025 240)" }}>{roleCounts[role] || 0}</div>
              <div className="text-xs mt-0.5" style={{ color: "oklch(0.52 0.025 240)" }}>{config.label}</div>
            </div>
          ))}
        </div>

        {/* 筛选 */}
        <div className="bg-white rounded-xl p-4" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input placeholder="搜索姓名/工号/学院" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 pl-8 text-xs" />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="角色筛选" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部角色</SelectItem>
                {Object.entries(ROLE_CONFIG).map(([role, config]) => (
                  <SelectItem key={role} value={role}>{config.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 用户列表 */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid oklch(0.90 0.01 240)" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "oklch(0.97 0.004 240)", borderBottom: "1px solid oklch(0.90 0.01 240)" }}>
                    {["姓名", "工号", "学院/督导范围", "角色", "附加角色", "操作"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold" style={{ color: "oklch(0.52 0.025 240)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((user) => {
                    const roleConf = ROLE_CONFIG[user.role || ""] || { label: "待配置角色", icon: <User className="w-3.5 h-3.5" />, color: "#64748b", bg: "#f1f5f9" };
                    const isSupervisor = SUPERVISOR_ROLES.includes(user.role || "");
                    const extraRoles = normalizeExtraRoles((user as any).extraRoles);
                    // 范围来自 supervisorScope 字段本身，不再由"有没有填学院"推断
                    const scopeLabel = getSupervisorScopeLabel(user as any);
                    return (
                      <tr key={user.id} className="hover:bg-muted/30 transition-colors" style={{ borderBottom: "1px solid oklch(0.93 0.006 240)" }}>
                        <td className="px-4 py-3 font-medium" style={{ color: "oklch(0.20 0.025 240)" }}>{user.name}</td>
                        <td className="px-4 py-3 text-xs font-mono" style={{ color: "oklch(0.52 0.025 240)" }}>{user.employeeId}</td>
                        <td className="px-4 py-3 text-xs max-w-[160px]" style={{ color: "oklch(0.52 0.025 240)" }}>
                          <span className="truncate block">{user.college || (isSupervisor ? "（未设置）" : "-")}</span>
                          {scopeLabel && (
                            <span
                              className="inline-block mt-0.5 px-1.5 py-0.5 rounded-full text-xs"
                              style={{
                                background: scopeLabel === "院级" ? "oklch(0.93 0.018 160)" : "oklch(0.93 0.018 240)",
                                color: scopeLabel === "院级" ? "oklch(0.42 0.14 160)" : "oklch(0.35 0.13 245)",
                              }}
                            >
                              {scopeLabel}督导
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-1 w-fit px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: roleConf.bg, color: roleConf.color }}>
                            {roleConf.icon}{roleConf.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1 max-w-[160px]">
                            {extraRoles.length > 0 ? (
                              extraRoles.map((r) => (
                                <Badge key={r} variant="outline" className="text-xs h-5 px-1.5">{ROLE_CONFIG[r]?.label || r}</Badge>
                              ))
                            ) : (
                              <span className="text-xs" style={{ color: "oklch(0.65 0.02 240)" }}>—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Select
                              value={user.role || "user"}
                              onValueChange={(newRole) => updateRoleMutation.mutate({ userId: user.id, role: newRole as any })}
                            >
                              <SelectTrigger className="h-7 w-28 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(ROLE_CONFIG).map(([role, config]) => (
                                  <SelectItem key={role} value={role} className="text-xs">{config.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button variant="outline" size="sm" className="h-7 w-7 p-0" title="设置附加角色 / 督导范围" onClick={() => openEditDialog(user)}>
                              <Settings2 className="w-3.5 h-3.5" />
                            </Button>
                            <Badge variant={user.disabled ? "destructive" : "outline"}>{user.disabled ? "已停用" : "正常"}</Badge>
                            <Button variant="outline" size="sm" onClick={() => { setTemporaryPassword(""); setAccountDialog({ mode: user.disabled ? "activate" : "reset", userId: user.id, name: user.name || "", employeeId: user.employeeId || "" }); }}>{user.disabled ? "启用" : "重置密码"}</Button>
                            {!user.disabled && <Button variant="outline" size="sm" disabled={disableAccount.isPending} onClick={() => { if (window.confirm(`停用 ${user.name || user.employeeId}？历史评价与课表不会删除。`)) disableAccount.mutate({ userId: user.id }); }}>停用</Button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 text-xs" style={{ color: "oklch(0.52 0.025 240)", borderTop: "1px solid oklch(0.90 0.01 240)" }}>
              共 {filtered.length} 位用户
            </div>
          </div>
        )}
      </div>

      {/* 附加角色 / 督导范围 设置弹窗 */}
      <Dialog open={editDialog.open} onOpenChange={(open) => setEditDialog((p) => ({ ...p, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>设置附加角色与督导范围</DialogTitle>
            <DialogDescription>
              {editDialog.name} · 多角色切换允许该用户在多个身份间随时切换；督导范围决定其可查看与评价的课程范围，校级为全校、院级仅限所属学院。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm">附加角色（在主角色之外，可同时拥有）</Label>
              <div className="grid grid-cols-2 gap-2">
                {ASSIGNABLE_ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={editDialog.extraRoles.includes(r)}
                      onCheckedChange={(checked) => toggleExtraRole(r, checked === true)}
                    />
                    {ROLE_CONFIG[r]?.label || r}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">督导范围</Label>
              <Select
                value={editDialog.supervisorScope}
                onValueChange={(v) => setEditDialog((p) => ({ ...p, supervisorScope: v as SupervisorScope }))}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="school">校级督导 —— 可查看并评价全校课程</SelectItem>
                  <SelectItem value="college">院级督导 —— 仅限所属学院课程</SelectItem>
                </SelectContent>
              </Select>
              {editDialog.supervisorScope === "college" && !editDialog.college.trim() && (
                <p className="text-xs" style={{ color: "oklch(0.55 0.14 30)" }}>
                  院级督导必须填写所属学院，否则保存时会按校级处理。
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="college-scope" className="text-sm">所属学院（院级督导范围 / 学院秘书管辖学院）</Label>
              <Input
                id="college-scope"
                placeholder="如：经济学院；多个学院用顿号分隔"
                value={editDialog.college}
                onChange={(e) => setEditDialog((p) => ({ ...p, college: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditDialog({ open: false, extraRoles: [], college: "", supervisorScope: "school" })}>取消</Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateProfile.isPending}
              style={{ background: "oklch(0.35 0.13 245)" }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!accountDialog} onOpenChange={open => { if (!open) { setAccountDialog(null); setTemporaryPassword(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{accountDialog?.mode === "create" ? "新增用户" : accountDialog?.mode === "activate" ? "启用账号" : "重置密码"}</DialogTitle><DialogDescription>设置一次性初始密码，并通过校内渠道告知本人。首次登录须修改密码。</DialogDescription></DialogHeader>
          {accountDialog?.mode === "create" ? <div className="space-y-3">
            <Label htmlFor="account-name">姓名</Label><Input id="account-name" value={accountDialog.name} onChange={e => setAccountDialog({ ...accountDialog, name: e.target.value })} />
            <Label htmlFor="account-id">工号</Label><Input id="account-id" value={accountDialog.employeeId} onChange={e => setAccountDialog({ ...accountDialog, employeeId: e.target.value })} />
            <Label>角色</Label><Select value={newRole} onValueChange={value => setNewRole(value as typeof newRole)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ASSIGNABLE_ROLES.map(role => <SelectItem key={role} value={role}>{ROLE_CONFIG[role].label}</SelectItem>)}</SelectContent></Select>
            <Label htmlFor="account-college">所属学院</Label><Input id="account-college" value={newCollege} onChange={e => setNewCollege(e.target.value)} />
            <Label>督导范围</Label><Select value={newScope} onValueChange={value => setNewScope(value as SupervisorScope)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="college">院级</SelectItem><SelectItem value="school">校级</SelectItem></SelectContent></Select>
          </div> : <p>{accountDialog?.name} · {accountDialog?.employeeId}</p>}
          <Label htmlFor="account-password">初始密码（10—128 位，字母及数字或符号）</Label><Input id="account-password" type="password" autoComplete="new-password" value={temporaryPassword} onChange={e => setTemporaryPassword(e.target.value)} />
          <DialogFooter><Button disabled={createAccount.isPending || resetPassword.isPending || activateAccount.isPending} onClick={() => {
            if (!accountDialog) return;
            if (accountDialog.mode === "create") createAccount.mutate({ name: accountDialog.name, employeeId: accountDialog.employeeId, password: temporaryPassword, role: newRole, extraRoles: [], college: newCollege.trim() || null, supervisorScope: newScope });
            else if (accountDialog.mode === "reset") resetPassword.mutate({ userId: accountDialog.userId!, password: temporaryPassword });
            else activateAccount.mutate({ userId: accountDialog.userId!, password: temporaryPassword });
          }}>确认保存</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
