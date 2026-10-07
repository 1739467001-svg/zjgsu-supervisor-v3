import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Calendar,
  MapPin,
  Clock,
  User,
  BookOpen,
  CheckCircle,
  XCircle,
  Trash2,
  ClipboardEdit,
  LayoutList,
  CalendarDays,
} from "lucide-react";
import { useLocation } from "wouter";
import PlanCalendarView from "@/components/PlanCalendarView";
import { formatDateBJ } from "@shared/dateUtils";
import { useSemesterSelection } from "@/contexts/SemesterSelection";
import { useSemester } from "@/hooks/useSemester";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const STATUS_MAP = {
  pending: {
    label: "待听课",
    color: "oklch(0.35 0.13 245)",
    bg: "oklch(0.93 0.018 240)",
  },
  completed: {
    label: "已评价",
    color: "oklch(0.42 0.14 160)",
    bg: "oklch(0.93 0.018 160)",
  },
  cancelled: {
    label: "已取消",
    color: "oklch(0.52 0.025 240)",
    bg: "oklch(0.93 0.010 240)",
  },
};

export default function MyPlans() {
  const { semesterId, isHistorical } = useSemesterSelection();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<"pending" | "completed" | "cancelled" | "all">("pending");
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const utils = trpc.useUtils();
  const { semester } = useSemester();
  const [editing, setEditing] = useState<{ id: number; week: string; note: string; weeks?: number[] | null } | null>(null);
  const editMutation = trpc.plans.update.useMutation({
    onSuccess: () => { toast.success("计划已修改"); setEditing(null); utils.plans.myPlans.invalidate(); utils.plans.getUsedWeeks.invalidate(); },
    onError: error => toast.error(error.message),
  });

  const { data: plans, isLoading } = trpc.plans.myPlans.useQuery({ semesterId });

  const updateStatusMutation = trpc.plans.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("状态已更新");
      utils.plans.myPlans.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.plans.delete.useMutation({
    onSuccess: () => {
      toast.success("已删除");
      utils.plans.myPlans.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const filteredPlans =
    plans?.filter((p) => activeTab === "all" || p.status === activeTab) || [];

  const tabs = [
    {
      key: "pending",
      label: "待听课",
      count: plans?.filter((p) => p.status === "pending").length || 0,
    },
    {
      key: "completed",
      label: "已评价",
      count: plans?.filter((p) => p.status === "completed").length || 0,
    },
    {
      key: "all",
      label: "全部",
      count: plans?.length || 0,
    },
  ];

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-5 page-transition">
        {/* 页头 */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1
              className="text-xl font-bold"
              style={{ color: "oklch(0.18 0.025 240)" }}
            >
              听课计划
            </h1>
            <p
              className="text-sm mt-0.5"
              style={{ color: "oklch(0.52 0.025 240)" }}
            >
              管理您的听课安排与督导任务
            </p>
          </div>

          {/* 视图切换 */}
          <div
            className="flex items-center gap-1 p-1 rounded-lg"
            style={{ background: "oklch(0.94 0.010 240)" }}
          >
            <button
              onClick={() => setViewMode("list")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
              style={{
                background: viewMode === "list" ? "white" : "transparent",
                color:
                  viewMode === "list"
                    ? "oklch(0.35 0.13 245)"
                    : "oklch(0.52 0.025 240)",
                boxShadow:
                  viewMode === "list"
                    ? "0 1px 3px oklch(0.35 0.13 245 / 0.1)"
                    : "none",
              }}
            >
              <LayoutList className="w-3.5 h-3.5" />
              列表
            </button>
            <button
              onClick={() => setViewMode("calendar")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
              style={{
                background: viewMode === "calendar" ? "white" : "transparent",
                color:
                  viewMode === "calendar"
                    ? "oklch(0.35 0.13 245)"
                    : "oklch(0.52 0.025 240)",
                boxShadow:
                  viewMode === "calendar"
                    ? "0 1px 3px oklch(0.35 0.13 245 / 0.1)"
                    : "none",
              }}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              日历
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : viewMode === "calendar" ? (
          /* ===== 日历视图 ===== */
          <div
            className="bg-white rounded-xl p-5"
            style={{ border: "1px solid oklch(0.90 0.01 240)" }}
          >
            <div className="flex items-center gap-2 mb-4">
              <CalendarDays
                className="w-5 h-5"
                style={{ color: "oklch(0.35 0.13 245)" }}
              />
              <h2
                className="text-sm font-semibold"
                style={{ color: "oklch(0.18 0.025 240)" }}
              >
                周历视图
              </h2>
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  background: "oklch(0.93 0.018 240)",
                  color: "oklch(0.35 0.13 245)",
                }}
              >
                共 {plans?.length || 0} 个计划
              </span>
            </div>
            <PlanCalendarView
              plans={(plans || []) as any}
              onStatusUpdate={(planId, status) =>
                updateStatusMutation.mutate({ planId, status })
              }
              isUpdating={updateStatusMutation.isPending}
            />
          </div>
        ) : (
          /* ===== 列表视图 ===== */
          <>
            {/* Tabs */}
            <div
              className="flex gap-1 p-1 rounded-lg"
              style={{ background: "oklch(0.94 0.010 240)" }}
            >
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key as any)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200"
                  style={{
                    background:
                      activeTab === tab.key ? "white" : "transparent",
                    color:
                      activeTab === tab.key
                        ? "oklch(0.35 0.13 245)"
                        : "oklch(0.52 0.025 240)",
                    boxShadow:
                      activeTab === tab.key
                        ? "0 1px 3px oklch(0.35 0.13 245 / 0.1)"
                        : "none",
                  }}
                >
                  {tab.label}
                  <span
                    className="px-1.5 py-0.5 rounded-full text-xs"
                    style={{
                      background:
                        activeTab === tab.key
                          ? "oklch(0.93 0.018 240)"
                          : "oklch(0.88 0.01 240)",
                      color: "oklch(0.35 0.13 245)",
                    }}
                  >
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {/* 计划列表 */}
            {filteredPlans.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center py-16 gap-3 bg-white rounded-xl"
                style={{ border: "1px solid oklch(0.90 0.01 240)" }}
              >
                <Calendar
                  className="w-12 h-12"
                  style={{ color: "oklch(0.75 0.02 240)" }}
                />
                <p
                  className="text-sm"
                  style={{ color: "oklch(0.52 0.025 240)" }}
                >
                  {activeTab === "pending"
                    ? "暂无待听课计划，去课程列表添加吧"
                    : "暂无记录"}
                </p>
                {activeTab === "pending" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate("/courses")}
                  >
                    <BookOpen className="w-4 h-4 mr-1.5" />
                    浏览课程
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredPlans.map((plan) => {
                  const status =
                    STATUS_MAP[plan.status as keyof typeof STATUS_MAP] ||
                    STATUS_MAP.pending;
                  const course = (plan as any).course;
                  return (
                    <div
                      key={plan.id}
                      className="bg-white rounded-xl p-5 transition-all duration-200 hover:shadow-md"
                      style={{ border: "1px solid oklch(0.90 0.01 240)" }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3
                              className="font-semibold text-sm"
                              style={{ color: "oklch(0.18 0.025 240)" }}
                            >
                              {course?.courseName || "未知课程"}
                            </h3>
                            <span
                              className="px-2 py-0.5 rounded-full text-xs font-medium"
                              style={{
                                background: status.bg,
                                color: status.color,
                              }}
                            >
                              {status.label}
                            </span>
                            {plan.planWeek && (
                              <span
                                className="px-2 py-0.5 rounded-full text-xs"
                                style={{
                                  background: "oklch(0.93 0.018 240)",
                                  color: "oklch(0.35 0.13 245)",
                                }}
                              >
                                第{plan.planWeek}周
                              </span>
                            )}
                          </div>

                          <div
                            className="flex flex-wrap gap-3 mt-2 text-xs"
                            style={{ color: "oklch(0.52 0.025 240)" }}
                          >
                            {course?.teacher && (
                              <span className="flex items-center gap-1">
                                <User className="w-3 h-3" />
                                {course.teacher}
                              </span>
                            )}
                            {course?.campus && (
                              <span className="flex items-center gap-1">
                                <MapPin className="w-3 h-3" />
                                {course.campus} · {course.classroom}
                              </span>
                            )}
                            {course?.weekday && (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {course.weekday} {course.period}
                              </span>
                            )}
                          </div>

                          {course?.college && (
                            <p
                              className="text-xs mt-1.5 truncate"
                              style={{ color: "oklch(0.55 0.02 240)" }}
                            >
                              {course.college}
                            </p>
                          )}
                        </div>

                        {/* 操作按钮 */}
                        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0 flex-wrap justify-end">
                          {plan.status === "pending" && !plan.evaluationId && !isHistorical && <Button size="sm" variant="outline" onClick={() => setEditing({ id: plan.id, week: plan.planWeek?.toString() || "none", note: plan.note || "", weeks: course?.weekNumbers })}>修改计划</Button>}
                          {plan.status === "pending" && !isHistorical && (
                            <Button
                              size="sm"
                              aria-label={plan.evaluationId && plan.evaluationStatus === "draft" ? "继续评价" : "填写评价"}
                              className="h-8 px-2 sm:px-3 text-xs gap-1"
                              onClick={() => {
                                // 若该课程已有草稿评价，直接跳转到续编模式；否则新建
                                if ((plan as any).evaluationId && (plan as any).evaluationStatus === 'draft') {
                                  navigate(`/evaluations/${(plan as any).evaluationId}/edit`);
                                } else {
                                  navigate(`/evaluations/new/${course?.id || plan.courseId}?planId=${plan.id}`);
                                }
                              }}
                            >
                              <ClipboardEdit className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">
                                {(plan as any).evaluationId && (plan as any).evaluationStatus === 'draft' ? '继续评价' : '填写评价'}
                              </span>
                            </Button>
                          )}
                          {plan.status === "completed" && (
                            <Button
                              size="sm"
                              aria-label="查看评价"
                              variant="outline"
                              className="h-8 px-2 sm:px-3 text-xs gap-1"
                              onClick={() => plan.evaluationId ? navigate(`/evaluations/${plan.evaluationId}`) : navigate("/evaluations")}
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">查看评价</span>
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2 sm:px-3 gap-1 text-xs text-destructive hover:text-destructive"
                            title="删除听课计划"
                            disabled={isHistorical}
                            onClick={() => deleteMutation.mutate(plan.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">删除</span>
                          </Button>
                        </div>
                      </div>

                      <p
                        className="text-xs mt-3"
                        style={{ color: "oklch(0.65 0.02 240)" }}
                      >
                        添加时间：
                        {formatDateBJ(plan.createdAt)}
                      </p>
                      {plan.note && <p className="text-sm mt-2 whitespace-pre-wrap break-words">备注：{plan.note}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
      <Dialog open={!!editing} onOpenChange={open => { if (!open) setEditing(null); }}>
        <DialogContent><DialogHeader><DialogTitle>修改听课计划</DialogTitle><DialogDescription>仅修改本人的待听课安排；已关联评价的计划受保护。</DialogDescription></DialogHeader>
          <Label htmlFor="edit-plan-week">计划周次</Label>
          <select id="edit-plan-week" className="border rounded-md p-2" value={editing?.week || "none"} onChange={event => setEditing(previous => previous ? { ...previous, week: event.target.value } : null)}>
            <option value="none">不指定周次</option>
            {Array.from({ length: semester.totalWeeks }, (_, i) => i + 1).filter(week => !editing?.weeks?.length || editing.weeks.includes(week)).map(week => <option key={week} value={week}>第{week}周</option>)}
          </select>
          <Label htmlFor="edit-plan-note">计划备注</Label><Textarea id="edit-plan-note" maxLength={1000} value={editing?.note || ""} onChange={event => setEditing(previous => previous ? { ...previous, note: event.target.value } : null)} />
          <Button disabled={!editing || editMutation.isPending || isHistorical} onClick={() => editing && editMutation.mutate({ planId: editing.id, planWeek: editing.week === "none" ? null : Number(editing.week), note: editing.note })}>保存修改</Button>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
