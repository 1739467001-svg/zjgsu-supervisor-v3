-- 独立、显式的增量变更。代码更新脚本不得自动执行。
-- 执行前确认列尚不存在并备份数据库；不修改任何历史学期、课程或评价。
ALTER TABLE `semesters`
  ADD COLUMN `mbaStartDate` varchar(10) NULL,
  ADD COLUMN `mbaTotalWeeks` int NULL;
