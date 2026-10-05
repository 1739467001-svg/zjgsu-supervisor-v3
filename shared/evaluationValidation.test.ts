import { describe, it, expect } from "vitest";
import { REQUIRED_SCORE_FIELDS, submissionErrors } from "./evaluationValidation";
const complete = { ...Object.fromEntries(REQUIRED_SCORE_FIELDS.map(key => [key, 4])), score_research_teaching: 4, overallScore: 4, highlights: "教学亮点", suggestions: "改进建议", actualWeek: 1 };
describe("正式评价完整性", () => {
  it("完整学术或专业学位评分均可提交", () => {
    expect(submissionErrors(complete)).toEqual([]);
    expect(submissionErrors({ ...complete, score_research_teaching: undefined, score_learning_effect: 4 })).toEqual([]);
  });
  it("缺项、越界、NaN和空白评语不能提交", () => {
    for (const patch of [{ overallScore: NaN }, { score_teaching_content: 0 }, { score_feedback: undefined }, { highlights: "  " }, { actualWeek: undefined }, { score_research_teaching: 99 }]) {
      expect(submissionErrors({ ...complete, ...patch }).length).toBeGreaterThan(0);
    }
  });
});
