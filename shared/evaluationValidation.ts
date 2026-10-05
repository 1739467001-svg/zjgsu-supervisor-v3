export const REQUIRED_SCORE_FIELDS = [
  "score_teaching_content", "score_course_objective", "score_reference_sharing", "score_literature_humanities", "score_teaching_organization",
  "score_course_development", "score_course_focus", "score_language_logic", "score_interaction", "score_learning_preparation",
  "score_teaching_quality", "score_active_response", "score_student_centered",
  "score_interaction_quality", "score_method_diversity", "score_equal_dialogue", "score_pace_control", "score_feedback",
] as const;
export function submissionErrors(data: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const validScore = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 5;
  if (REQUIRED_SCORE_FIELDS.some(key => !validScore(data[key]))) errors.push("请完成必填定量评分");
  if (!validScore(data.score_research_teaching) && !validScore(data.score_learning_effect)) errors.push("请填写学术学位或专业学位对应的评分");
  if (!validScore(data.overallScore)) errors.push("请填写综合评分");
  if (!(typeof data.highlights === "string" && data.highlights.trim())) errors.push("请填写最突出的教学亮点");
  if (!(typeof data.suggestions === "string" && data.suggestions.trim())) errors.push("请填写存在不足与提升建议");
  if (!data.actualWeek && !data.listenDate) errors.push("请选择实际听课周次或日期");
  return errors;
}
