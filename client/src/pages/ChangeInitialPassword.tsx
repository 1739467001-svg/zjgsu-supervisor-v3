import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function ChangeInitialPassword() {
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const mutation = trpc.auth.changePassword.useMutation({
    onSuccess: () => { toast.success("密码已更新，请重新登录"); window.location.href = "/login"; },
    onError: error => toast.error(error.message),
  });
  return <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
    <form className="w-full max-w-md rounded-xl bg-white border border-slate-200 p-8 space-y-5" onSubmit={event => {
      event.preventDefault();
      if (newPassword !== confirmation) { toast.error("两次输入的新密码不一致"); return; }
      mutation.mutate({ oldPassword, newPassword });
    }}>
      <h1 className="text-xl font-semibold">设置您的登录密码</h1>
      <p className="text-sm text-slate-600">初始或重置密码仅用于首次登录。请设置 10—128 位新密码，包含字母及数字或符号，不能与工号相同。</p>
      <div className="space-y-2"><Label htmlFor="initial-old">初始或重置密码</Label><Input id="initial-old" type="password" autoComplete="current-password" required value={oldPassword} onChange={e => setOld(e.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="initial-new">新密码</Label><Input id="initial-new" type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={newPassword} onChange={e => setNew(e.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="initial-confirm">确认新密码</Label><Input id="initial-confirm" type="password" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} /></div>
      <Button className="w-full" disabled={mutation.isPending}>保存并重新登录</Button>
    </form>
  </main>;
}
