const DEFAULT_WINDOW_WEEKS = 2;

function toNumber(value) {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function toRate(part, total) {
  return total > 0 ? Number((part / total).toFixed(4)) : null;
}

function getGoalKey(goal) {
  const productId = goal.productId ?? goal.product_id ?? null;
  if (productId !== null && productId !== undefined) return `id:${productId}`;
  return `name:${String(goal.productName || goal.product_name || "").toLowerCase()}`;
}

function buildGoalCompensationSummary(weeklyResults = [], options = {}) {
  const windowWeeks = Number(options.windowWeeks || DEFAULT_WINDOW_WEEKS);
  const completedWeeks = weeklyResults
    .filter((weekResult) => weekResult && weekResult.isComplete !== false)
    .sort((a, b) => Number(a.weeksAgo || 0) - Number(b.weeksAgo || 0))
    .slice(0, windowWeeks);

  const byTortMap = new Map();
  let totalGoals = 0;
  let actualMetGoals = 0;

  completedWeeks.forEach((weekResult) => {
    (weekResult.goals || []).forEach((goal) => {
      const key = getGoalKey(goal);
      const target = toNumber(goal.target ?? goal.weeklyTarget);
      const actual = toNumber(goal.actual ?? goal.actualOutflow);
      const met = Boolean(goal.met ?? goal.goalMet);

      totalGoals += 1;
      if (met) actualMetGoals += 1;

      if (!byTortMap.has(key)) {
        byTortMap.set(key, {
          productId: goal.productId ?? goal.product_id ?? null,
          productName: goal.productName ?? goal.product_name ?? null,
          weeksEvaluated: 0,
          weeklyTarget: target,
          totalTarget: 0,
          actualOutflow: 0,
          actualMetWeeks: 0,
          weeklyBreakdown: [],
        });
      }

      const entry = byTortMap.get(key);
      entry.weeksEvaluated += 1;
      entry.totalTarget += target;
      entry.actualOutflow += actual;
      if (met) entry.actualMetWeeks += 1;
      entry.weeklyBreakdown.push({
        weekStart: weekResult.week?.startStr || weekResult.weekStart || null,
        weekEnd: weekResult.week?.endStr || weekResult.weekEnd || null,
        target,
        actualOutflow: actual,
        actualMet: met,
      });
    });
  });

  const byTort = Array.from(byTortMap.values()).map((entry) => {
    const deficit = Math.max(entry.totalTarget - entry.actualOutflow, 0);
    const surplus = Math.max(entry.actualOutflow - entry.totalTarget, 0);
    const eligibleAfterCompensation =
      entry.weeksEvaluated > 0 && entry.actualOutflow >= entry.totalTarget;
    const usedCompensation =
      eligibleAfterCompensation && entry.actualMetWeeks < entry.weeksEvaluated;

    return {
      ...entry,
      deficit,
      surplus,
      eligibleAfterCompensation,
      usedCompensation,
      actualGoalComplianceRate: toRate(
        entry.actualMetWeeks,
        entry.weeksEvaluated,
      ),
    };
  });

  const totalTarget = byTort.reduce((sum, item) => sum + item.totalTarget, 0);
  const totalOutflow = byTort.reduce(
    (sum, item) => sum + item.actualOutflow,
    0,
  );
  const totalDeficit = byTort.reduce((sum, item) => sum + item.deficit, 0);
  const totalSurplus = byTort.reduce((sum, item) => sum + item.surplus, 0);
  const hasCompleteWindow = completedWeeks.length >= windowWeeks;
  const hasGoals = byTort.length > 0 && totalGoals > 0;
  const eligibleAfterCompensation =
    hasCompleteWindow &&
    hasGoals &&
    byTort.every((item) => item.eligibleAfterCompensation);
  const applied =
    eligibleAfterCompensation && byTort.some((item) => item.usedCompensation);

  let messageCode = "goal_compensation_not_evaluated";
  let message =
    "Goal compensation was not evaluated because there are not enough completed weeks.";

  if (hasCompleteWindow && hasGoals && eligibleAfterCompensation && applied) {
    messageCode = "goal_compensation_applied";
    message = `Goal compensation applied: ${totalOutflow}/${totalTarget} outflow across ${completedWeeks.length} completed weeks.`;
  } else if (hasCompleteWindow && hasGoals && eligibleAfterCompensation) {
    messageCode = "goal_compensation_not_needed";
    message = `Completed weekly goals met without compensation: ${totalOutflow}/${totalTarget} outflow.`;
  } else if (hasCompleteWindow && hasGoals) {
    messageCode = "goal_compensation_insufficient";
    message = `Goal compensation insufficient: ${totalOutflow}/${totalTarget} outflow, deficit ${totalDeficit}.`;
  }

  return {
    enabled: true,
    mode: "completed_weeks_balance",
    windowWeeks,
    completedWeeksEvaluated: completedWeeks.length,
    totalGoals,
    actualMetGoals,
    actualGoalComplianceRate: toRate(actualMetGoals, totalGoals),
    eligibleAfterCompensation,
    applied,
    totalTarget,
    totalOutflow,
    totalDeficit,
    totalSurplus,
    messageCode,
    message,
    byTort,
  };
}

module.exports = {
  buildGoalCompensationSummary,
};
