/** 只读课表预检。正式写入统一走网页预览/确认，不自动归档或删除课程。 */
import { readFileSync } from "node:fs";
import { parseCourseWorkbook, mergeDuplicateCourses } from "../server/courseImport";
const argv = process.argv.slice(2), options: Record<string, string> = {}, files: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (["--semester", "--start-date", "--weeks"].includes(arg)) options[arg] = argv[++i] || "";
  else if (arg.startsWith("--")) throw new Error("命令行写入已关闭，请使用上传课程数据页面先预览再确认；启用学期请在学期管理操作");
  else files.push(arg);
}
const start = options["--start-date"], [year, term] = (options["--semester"] || "").split("/");
const weeks = Number(options["--weeks"] || 18), date = new Date(`${start}T00:00:00Z`);
if (!files.length || !year || !term || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== start || date.getUTCDay() !== 1 || !Number.isInteger(weeks) || weeks < 1 || weeks > 30) throw new Error("请指定文件、--semester 学年/学期、--start-date 第一周周一及有效周数");
if (year === "2026-2027" && term === "第一学期" && start !== "2026-09-14") throw new Error("浙江工商大学2026年秋季第一周从2026-09-14开始");
const parsed = files.map(file => parseCourseWorkbook(readFileSync(file), { semesterStartDate: start, totalWeeks: weeks }));
const merged = mergeDuplicateCourses(parsed.flatMap(p => p.courses));
if (merged.merged.some(c => c.academicYear !== year || c.semester !== term)) throw new Error("文件学期与目标不一致");
console.log(JSON.stringify({ mode: "只读预检，未连接数据库", semester: `${year}/${term}`, startDate: start, totalWeeks: weeks, courses: merged.merged.length, mergedGroups: merged.mergedGroups, colleges: new Set(merged.merged.map(c => c.college)).size, sources: parsed.map(p => ({ format: p.format, sourceRows: p.sourceRows, courses: p.courses.length, warnings: p.warnings })) }, null, 2));
