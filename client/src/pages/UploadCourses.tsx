import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useSemesterSelection } from "@/contexts/SemesterSelection";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { courseIssuesCsv, type CourseImportIssue } from "@shared/courseImportDiagnostics";
type Preview = { success: boolean; applied?: boolean; message: string; previewToken?: string; summary?: { sourceRows: number; total: number; inserted: number; updated: number; unchanged: number; preserved: number; conflicts: string[]; warnings: string[]; issues?: CourseImportIssue[]; sheetName?: string } };

function CourseUpload({ format, semesterId, label }: { format: "standard" | "mba"; semesterId: number; label: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const utils = trpc.useUtils();
  async function submit(action: "preview" | "apply") {
    if (!file) return;
    if (action === "apply" && !window.confirm(`确认导入 ${label} 的${format === "mba" ? "MBA" : "非 MBA"}课表？历史记录保留。`)) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file); body.append("semesterId", String(semesterId)); body.append("format", format); body.append("action", action);
      if (action === "apply") body.append("previewToken", preview?.previewToken || "");
      const response = await fetch("/api/upload-courses", { method: "POST", credentials: "include", body });
      const result = await response.json() as Preview;
      setPreview(result);
      if (result.applied) await utils.invalidate();
    } catch { setPreview({ success: false, message: "请求未完成。请重新预览核实实际数据，再决定是否导入。" }); }
    finally { setBusy(false); }
  }
  const summary = preview?.summary;
  const issues = summary?.issues || [];
  function downloadIssues() {
    const url = URL.createObjectURL(new Blob([courseIssuesCsv(issues, summary?.sheetName || "")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `${label}-${format === "mba" ? "MBA" : "非MBA"}-课表核查清单.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
    <h2 className="text-lg font-semibold">{format === "mba" ? "MBA 课表" : "研究生排课信息表（不含 MBA）"}</h2>
    <p className="text-sm text-slate-600">{format === "mba" ? "按课表日期和目标学期第一周换算周次。" : "按排课表的学院、教师及周次导入。"} 先预览确认，再正式导入。</p>
    <Label htmlFor={`upload-${format}`}>选择 .xls 或 .xlsx 文件，最大 20MB</Label>
    <Input id={`upload-${format}`} type="file" accept=".xls,.xlsx" disabled={busy} onChange={event => { setFile(event.target.files?.[0] || null); setPreview(null); }} />
    <Button disabled={!file || busy} onClick={() => submit("preview")}>{busy ? "处理中…" : "预览导入结果"}</Button>
    {preview && <div role={preview.success ? "status" : "alert"} className={`rounded-lg border p-4 space-y-3 ${preview.success ? "border-blue-200 bg-blue-50" : "border-red-200 bg-red-50"}`}>
      <p className="text-sm">{preview.message}</p>
      {summary && <>
        <dl className="grid grid-cols-2 gap-2 text-sm">{[["源文件行数", summary.sourceRows], ["合并后课程数", summary.total], ["新增", summary.inserted], ["更新", summary.updated], ["无变化", summary.unchanged], ["未出现但保留", summary.preserved]].map(([name, count]) => <div key={String(name)}><dt className="text-slate-600">{name}</dt><dd className="font-semibold">{count}</dd></div>)}</dl>
        {summary.warnings.length > 0 && <ul className="text-sm list-disc pl-5">{summary.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        {issues.length > 0 && <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-950">待核查 {issues.length} 项，涉及原文件 {new Set(issues.map(issue => issue.sourceRow)).size} 行</p>
          <p className="text-amber-950">请按原工作表「{summary.sheetName}」和行号核对。预览不修改原文件；没有有效周次的课程不能安排听课或评分。</p>
          <Button variant="outline" onClick={downloadIssues}>下载核查清单（CSV）</Button>
          <details><summary className="cursor-pointer font-medium text-amber-950">展开课表核查明细</summary>
            <div className="mt-3 max-h-80 overflow-auto rounded border border-amber-200 bg-white">
              <table className="w-full min-w-[650px] text-left text-sm">
                <caption className="sr-only">{format === "mba" ? "MBA" : "非MBA"}课表待核查明细</caption>
                <thead className="sticky top-0 bg-amber-100"><tr>{["原行号", "课程 / 班级 / 教师", "原日期 / 换算周次", "待核查原因"].map(title => <th key={title} scope="col" className="p-2 font-medium">{title}</th>)}</tr></thead>
                <tbody>{issues.map((issue, index) => <tr key={`${issue.sourceRow}-${issue.kind}-${index}`} className="border-t border-slate-100 align-top">
                  <td className="p-2">{issue.sourceRow}</td><td className="p-2"><p>{issue.courseName || "缺少课程名称"}</p><p className="text-xs text-slate-600">{issue.classId || "未填班级"} · {issue.teacher || "未填教师"}</p></td>
                  <td className="p-2"><p>{issue.date || "—"}</p>{issue.week !== null && <p>第{issue.week}周</p>}</td><td className="p-2">{issue.reason}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </details>
        </div>}
        {summary.conflicts.length > 0 && <div><p className="font-medium text-red-800">存在 {summary.conflicts.length} 个冲突，不能正式导入</p><ul className="text-sm list-disc pl-5">{summary.conflicts.map((conflict, index) => <li key={index}>{conflict}</li>)}</ul></div>}
      </>}
      {preview.success && !preview.applied && preview.previewToken && <Button disabled={busy || !!summary?.conflicts.length} onClick={() => submit("apply")}>确认正式导入</Button>}
    </div>}
  </section>;
}
export default function UploadCourses() {
  const { semesterId, label, isHistorical, semester } = useSemesterSelection();
  return <DashboardLayout><main className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
    <h1 className="text-2xl font-semibold">上传课程数据</h1>
    <p className="text-sm text-slate-600">目标学期：{label}。两类课表统一展示，历史课表与评价保留。</p>
    {isHistorical ? <p role="status">历史学期只读，请选择当前学期。</p> : semesterId ? <>
      <p className="rounded-lg border border-slate-200 p-4 text-sm">第一周起始日：{semester?.startDate || "待配置"}。已关联评价或听课计划的课程禁止覆盖；文件或数据库变化后须重新预览。</p>
      <div className="grid gap-5 lg:grid-cols-2"><CourseUpload key={`standard-${semesterId}`} format="standard" semesterId={semesterId} label={label} /><CourseUpload key={`mba-${semesterId}`} format="mba" semesterId={semesterId} label={label} /></div>
    </> : <p role="alert">请先建立并选择当前学期。</p>}
  </main></DashboardLayout>;
}
