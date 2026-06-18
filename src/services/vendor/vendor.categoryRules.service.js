/**
 * Vendor category rules engine.
 * Evaluates weekly outflow goals, fraud/quality conditions, and top vendor criteria.
 * Runs automatically after each vendor sync to keep categories and alerts current.
 */
const { Op, DataTypes } = require("sequelize");
const sequelize = require("../../config/db");
const logger = require("../../utils/logger");
const {
  getUsBusinessDaysWindowStartDate,
} = require("../../utils/usBusinessDays");
const {
  Vendor,
  VendorProfile,
  VendorTortAssignment,
  VendorCaseSnapshot,
  VendorWeeklyGoal,
  VendorCategoryLog,
  VendorTopReward,
  Product,
} = require("../../models");
const { publishVendorMonitoringAlert } = require("./vendor.alerts.service");
const {
  buildGoalCompensationSummary,
} = require("./vendor.goalCompensation.service");

// =============================================
// RULE CONSTANTS
// =============================================

// Weekly outflow targets per tort type (signed cases/week)
const WEEKLY_OUTFLOW_TARGETS = {
  rideshare: 5,
  bardPort: 5,
  default: 2,
};

// Missing both completed evaluation weeks keeps/promotes under_review.
const CONSECUTIVE_MISS_THRESHOLD = 2;

// Top vendor constraints
const TOP_VENDOR_MAX = 20;
const TOP_CONVERSION_WINDOW_DAYS = 90;
const TOP_CONVERSION_WINDOW_TYPE = "us_business_days";
const TOP_MIN_ACCEPTED_TO_INFLOW_RATE_PERCENT = 15;

// Vendors qualify for top by meeting all weekly outflow goals in completed weeks.

// Consecutive underperforming weeks before demotion from top
const TOP_UNDERPERFORM_WEEKS_THRESHOLD = 4;

// Fraud/quality thresholds
// Only Fake Lead is treated as fraud signal.
const FRAUD_SUBSTATUS_VALUES = ["fake lead"];
const FRAUD_RATE_THRESHOLD = 0.2; // 20%+ of cases flagged as Fake Lead
const LOW_CONVERSION_THRESHOLD = 0.02; // less than 2% accepted

// Show current week + previous 2; classify only from complete weeks.
const GOAL_DISPLAY_WEEKS = 3;
const GOAL_CLASSIFICATION_COMPLETED_WEEKS = 2;
const NEW_VENDOR_PROBATION_WEEKS = GOAL_CLASSIFICATION_COMPLETED_WEEKS;
const GOAL_RULE_LOOKBACK_WEEKS = Math.max(
  GOAL_DISPLAY_WEEKS,
  NEW_VENDOR_PROBATION_WEEKS + 1,
);

// =============================================
// WEEK HELPERS
// =============================================

/**
 * Returns boundaries for a complete ISO week (Mon–Sun) N weeks ago.
 * weeksAgo=1 → last complete week; weeksAgo=2 → two weeks ago.
 */
function getWeekBoundaries(weeksAgo) {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon…6=Sat
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const thisMonday = new Date(now);
  thisMonday.setUTCDate(now.getUTCDate() - daysToMonday);
  thisMonday.setUTCHours(0, 0, 0, 0);

  const targetMonday = new Date(thisMonday);
  targetMonday.setUTCDate(thisMonday.getUTCDate() - weeksAgo * 7);

  const targetSunday = new Date(targetMonday);
  targetSunday.setUTCDate(targetMonday.getUTCDate() + 6);
  targetSunday.setUTCHours(23, 59, 59, 999);

  return {
    start: targetMonday,
    end: targetSunday,
    startStr: targetMonday.toISOString().split("T")[0],
    endStr: targetSunday.toISOString().split("T")[0],
  };
}

/** Returns the current ISO week start as YYYY-MM-DD. */
function getCurrentWeekStartStr() {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - daysToMonday);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString().split("T")[0];
}

function getLastDaysStart(days) {
  return getUsBusinessDaysWindowStartDate(days);
}

function getProfileVendorInfo(profile) {
  return profile?.vendorInfo || null;
}

function isProfileCurrentlyActive(profile) {
  const vendorInfo = getProfileVendorInfo(profile);
  return vendorInfo ? vendorInfo.status === "active" : Boolean(profile.active);
}

function getProfileDisplayInfo(profile) {
  const vendorInfo = getProfileVendorInfo(profile);
  return {
    supplier: vendorInfo?.contact_name || profile.supplier || null,
    username: vendorInfo?.email || profile.username || null,
  };
}

function isAcceptedCaseSnapshot(snapshot) {
  return (
    String(snapshot?.sub_status || "")
      .trim()
      .toLowerCase() === "accepted"
  );
}

// =============================================
// GOAL TARGET RESOLUTION
// =============================================

function getWeeklyOutflowTarget(tortName) {
  const name = String(tortName || "").toLowerCase();
  if (name.includes("rideshare")) return WEEKLY_OUTFLOW_TARGETS.rideshare;
  if (name.includes("bard") && name.includes("port")) {
    return WEEKLY_OUTFLOW_TARGETS.bardPort;
  }
  return WEEKLY_OUTFLOW_TARGETS.default;
}

function doesSnapshotMatchAssignment(snapshot, assignment, productName) {
  const snapshotProductId = Number(snapshot.product_id || 0);
  const assignmentProductId = Number(assignment.product_id || 0);

  if (snapshotProductId && assignmentProductId) {
    return snapshotProductId === assignmentProductId;
  }

  return (
    String(snapshot.caseProduct?.name || snapshot.product?.name || "")
      .trim()
      .toLowerCase() === productName.toLowerCase()
  );
}

// =============================================
// EVALUATION FUNCTIONS
// =============================================

/**
 * Computes outflow counts and goal pass/fail for the latest ISO weeks.
 * Uses local snapshot data — no Salesforce call needed.
 */
function computeWeeklyGoalResults(assignments, snapshots) {
  if (!assignments.length) return [];

  const results = [];
  const now = new Date();

  for (let w = 0; w < GOAL_RULE_LOOKBACK_WEEKS; w++) {
    const week = getWeekBoundaries(w);
    const isComplete = now > week.end;

    const weekSnapshots = snapshots.filter((s) => {
      if (!s.signed_date) return false;
      const d = new Date(s.signed_date);
      return d >= week.start && d <= week.end;
    });

    const goalResults = assignments.map((assignment) => {
      const productName = String(assignment.product?.name || "").trim();
      const target = getWeeklyOutflowTarget(productName);

      const actualOutflow = weekSnapshots.filter((snapshot) =>
        doesSnapshotMatchAssignment(snapshot, assignment, productName),
      ).length;

      return {
        productId: assignment.product_id,
        productName,
        target,
        actual: actualOutflow,
        met: actualOutflow >= target,
      };
    });

    const allMissed =
      goalResults.length > 0 && goalResults.every((g) => !g.met);

    results.push({
      week,
      weeksAgo: w,
      isComplete,
      goals: goalResults,
      allMissed,
    });
  }

  return results;
}

function getClassificationWeeklyResults(weeklyResults) {
  return weeklyResults
    .filter((result) => result.isComplete)
    .sort((a, b) => a.weeksAgo - b.weeksAgo)
    .slice(0, GOAL_CLASSIFICATION_COMPLETED_WEEKS);
}

function getNewVendorProbationWeeklyResults(weeklyResults) {
  return weeklyResults
    .filter((result) => result.isComplete)
    .sort((a, b) => a.weeksAgo - b.weeksAgo)
    .slice(0, NEW_VENDOR_PROBATION_WEEKS);
}

function buildCurrentWeekProgress(weeklyResults) {
  const currentWeek = weeklyResults.find((result) => result.weeksAgo === 0);
  const goals = currentWeek?.goals || [];
  const totalTarget = goals.reduce(
    (sum, goal) => sum + Number(goal.target || 0),
    0,
  );
  const totalOutflow = goals.reduce(
    (sum, goal) => sum + Number(goal.actual || 0),
    0,
  );

  return {
    weekStart: currentWeek?.week?.startStr || null,
    weekEnd: currentWeek?.week?.endStr || null,
    totalTarget,
    totalOutflow,
    byTort: goals.map((goal) => ({
      productId: goal.productId,
      productName: goal.productName,
      target: goal.target,
      actualOutflow: goal.actual,
      goalMet: goal.met,
    })),
  };
}

function getFailedTortNames(summary) {
  return (summary?.byTort || [])
    .filter((item) => !item.eligibleAfterCompensation)
    .map((item) => item.productName || `Product ${item.productId}`)
    .filter(Boolean);
}

function hasMixedTortPerformance(summary) {
  const byTort = summary?.byTort || [];
  const failedCount = byTort.filter(
    (item) => !item.eligibleAfterCompensation,
  ).length;
  const passedCount = byTort.length - failedCount;
  return failedCount > 0 && passedCount > 0;
}

function formatTortList(names = []) {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function buildNewVendorProbationStatus(isNewVendor, weeklyResults) {
  if (!isNewVendor) {
    return {
      enabled: false,
      subcategory: null,
      status: null,
      actionRequired: false,
      shouldDeactivate: false,
      recommendedAction: null,
    };
  }

  const probationWeeks = getNewVendorProbationWeeklyResults(weeklyResults);
  const completedWeeksEvaluated = probationWeeks.length;
  const finalSummary = buildGoalCompensationSummary(probationWeeks, {
    windowWeeks: NEW_VENDOR_PROBATION_WEEKS,
  });
  const progressSummary = buildGoalCompensationSummary(probationWeeks, {
    windowWeeks: Math.max(completedWeeksEvaluated, 1),
  });
  const trialComplete = completedWeeksEvaluated >= NEW_VENDOR_PROBATION_WEEKS;
  const currentWeekProgress = buildCurrentWeekProgress(weeklyResults);

  let status = "pending";
  let subcategory = "new_trial_pending";
  let messageCode = "new_trial_pending";
  let message = "New vendor trial has no completed weeks yet.";
  let actionRequired = false;
  let shouldDeactivate = false;
  let recommendedAction = "monitor_vendor";

  if (trialComplete && finalSummary.eligibleAfterCompensation) {
    status = "passed";
    subcategory = "new_trial_passed";
    messageCode = "new_trial_passed";
    message = `New vendor passed the ${NEW_VENDOR_PROBATION_WEEKS}-completed-week trial: ${finalSummary.totalOutflow}/${finalSummary.totalTarget} outflow.`;
    recommendedAction = "none";
  } else if (trialComplete && hasMixedTortPerformance(finalSummary)) {
    const failedTorts = getFailedTortNames(finalSummary);
    status = "tort_action_required";
    subcategory = "new_trial_tort_deactivation_required";
    messageCode = "new_trial_tort_deactivation_required";
    message = `New vendor has assigned tort underperformance in ${formatTortList(failedTorts)}: ${finalSummary.totalOutflow}/${finalSummary.totalTarget} outflow, deficit ${finalSummary.totalDeficit}.`;
    actionRequired = true;
    shouldDeactivate = false;
    recommendedAction = "deactivate_underperforming_torts";
  } else if (trialComplete) {
    status = "failed";
    subcategory = "new_trial_deactivation_required";
    messageCode = "new_trial_deactivation_required";
    message = `New vendor failed the ${NEW_VENDOR_PROBATION_WEEKS}-completed-week trial: ${finalSummary.totalOutflow}/${finalSummary.totalTarget} outflow, deficit ${finalSummary.totalDeficit}.`;
    actionRequired = true;
    shouldDeactivate = true;
    recommendedAction = "deactivate_vendor";
  } else if (
    completedWeeksEvaluated > 0 &&
    progressSummary.eligibleAfterCompensation
  ) {
    status = "on_track";
    subcategory = "new_trial_on_track";
    messageCode = "new_trial_on_track";
    message = `New vendor is on track during trial: ${progressSummary.totalOutflow}/${progressSummary.totalTarget} outflow so far.`;
  } else if (completedWeeksEvaluated > 0 && progressSummary.totalOutflow > 0) {
    status = "partial";
    subcategory = "new_trial_partial";
    messageCode = "new_trial_partial";
    message = `New vendor is partially meeting trial goals: ${progressSummary.totalOutflow}/${progressSummary.totalTarget} outflow so far.`;
    actionRequired = true;
  } else if (completedWeeksEvaluated > 0) {
    status = "at_risk";
    subcategory = "new_trial_at_risk";
    messageCode = "new_trial_at_risk";
    message = "New vendor has no outflow in completed trial weeks.";
    actionRequired = true;
  }

  const summary = trialComplete ? finalSummary : progressSummary;

  return {
    enabled: true,
    trialWeeks: NEW_VENDOR_PROBATION_WEEKS,
    completedWeeksEvaluated,
    remainingWeeks: Math.max(
      NEW_VENDOR_PROBATION_WEEKS - completedWeeksEvaluated,
      0,
    ),
    trialComplete,
    status,
    subcategory,
    actionRequired,
    shouldDeactivate,
    recommendedAction,
    messageCode,
    message,
    totalTarget: summary.totalTarget,
    totalOutflow: summary.totalOutflow,
    totalDeficit: summary.totalDeficit,
    totalSurplus: summary.totalSurplus,
    byTort: summary.byTort,
    currentWeekProgress,
  };
}

function buildUnderReviewProductivityStatus(isUnderReview, weeklyResults) {
  if (!isUnderReview) {
    return {
      enabled: false,
      subcategory: null,
      status: null,
      actionRequired: false,
      shouldDeactivate: false,
      recommendedAction: null,
    };
  }

  const reviewWeeks = getClassificationWeeklyResults(weeklyResults);
  const completedWeeksEvaluated = reviewWeeks.length;
  const finalSummary = buildGoalCompensationSummary(reviewWeeks, {
    windowWeeks: GOAL_CLASSIFICATION_COMPLETED_WEEKS,
  });
  const progressSummary = buildGoalCompensationSummary(reviewWeeks, {
    windowWeeks: Math.max(completedWeeksEvaluated, 1),
  });
  const reviewComplete =
    completedWeeksEvaluated >= GOAL_CLASSIFICATION_COMPLETED_WEEKS;
  const currentWeekProgress = buildCurrentWeekProgress(weeklyResults);

  let status = "pending";
  let subcategory = "under_review_productivity_pending";
  let messageCode = "under_review_productivity_pending";
  let message = "Under review productivity has no completed weeks yet.";
  let actionRequired = false;
  let shouldDeactivate = false;
  let recommendedAction = "monitor_vendor";

  if (reviewComplete && finalSummary.eligibleAfterCompensation) {
    status = "productive";
    subcategory = "under_review_productivity_recovered";
    messageCode = "under_review_productivity_recovered";
    message = `Under review vendor met ${GOAL_CLASSIFICATION_COMPLETED_WEEKS}-completed-week productivity goals: ${finalSummary.totalOutflow}/${finalSummary.totalTarget} outflow.`;
    recommendedAction = "none";
  } else if (reviewComplete && hasMixedTortPerformance(finalSummary)) {
    const failedTorts = getFailedTortNames(finalSummary);
    status = "tort_action_required";
    subcategory = "under_review_tort_deactivation_required";
    messageCode = "under_review_tort_deactivation_required";
    message = `Under review vendor has assigned tort underperformance in ${formatTortList(failedTorts)}: ${finalSummary.totalOutflow}/${finalSummary.totalTarget} outflow, deficit ${finalSummary.totalDeficit}.`;
    actionRequired = true;
    shouldDeactivate = false;
    recommendedAction = "deactivate_underperforming_torts";
  } else if (reviewComplete) {
    status = "failed";
    subcategory = "under_review_deactivation_required";
    messageCode = "under_review_deactivation_required";
    message = `Under review vendor failed ${GOAL_CLASSIFICATION_COMPLETED_WEEKS}-completed-week productivity goals: ${finalSummary.totalOutflow}/${finalSummary.totalTarget} outflow, deficit ${finalSummary.totalDeficit}.`;
    actionRequired = true;
    shouldDeactivate = true;
    recommendedAction = "deactivate_vendor";
  } else if (
    completedWeeksEvaluated > 0 &&
    progressSummary.eligibleAfterCompensation
  ) {
    status = "on_track";
    subcategory = "under_review_productivity_on_track";
    messageCode = "under_review_productivity_on_track";
    message = `Under review vendor is on track: ${progressSummary.totalOutflow}/${progressSummary.totalTarget} outflow so far.`;
  } else if (completedWeeksEvaluated > 0 && progressSummary.totalOutflow > 0) {
    status = "partial";
    subcategory = "under_review_productivity_partial";
    messageCode = "under_review_productivity_partial";
    message = `Under review vendor is partially productive: ${progressSummary.totalOutflow}/${progressSummary.totalTarget} outflow so far.`;
    actionRequired = true;
  } else if (completedWeeksEvaluated > 0) {
    status = "at_risk";
    subcategory = "under_review_productivity_at_risk";
    messageCode = "under_review_productivity_at_risk";
    message =
      "Under review vendor has no outflow in completed productivity weeks.";
    actionRequired = true;
  }

  const summary = reviewComplete ? finalSummary : progressSummary;

  return {
    enabled: true,
    reviewWeeks: GOAL_CLASSIFICATION_COMPLETED_WEEKS,
    completedWeeksEvaluated,
    remainingWeeks: Math.max(
      GOAL_CLASSIFICATION_COMPLETED_WEEKS - completedWeeksEvaluated,
      0,
    ),
    reviewComplete,
    status,
    subcategory,
    actionRequired,
    shouldDeactivate,
    recommendedAction,
    messageCode,
    message,
    totalTarget: summary.totalTarget,
    totalOutflow: summary.totalOutflow,
    totalDeficit: summary.totalDeficit,
    totalSurplus: summary.totalSurplus,
    byTort: summary.byTort,
    currentWeekProgress,
  };
}

/** Counts consecutive leading weeks where ALL goals were missed. */
function countConsecutiveMissedWeeks(weeklyResults) {
  let count = 0;
  for (const wr of weeklyResults) {
    if (wr.allMissed) count++;
    else break;
  }
  return count;
}

/** Evaluates fraud/quality risk from local snapshot data. */
function computeFraudRisk(snapshots) {
  const total = snapshots.length;
  if (!total) return { isFraudRisk: false, fraudRate: 0, conversionRate: 0 };

  const fraudCount = snapshots.filter((s) =>
    FRAUD_SUBSTATUS_VALUES.includes(
      String(s.sub_status || "")
        .trim()
        .toLowerCase(),
    ),
  ).length;

  const acceptedCount = snapshots.filter((s) => Boolean(s.signed_date)).length;
  const fraudRate = fraudCount / total;
  const conversionRate = acceptedCount / total;
  const isFraudRisk = fraudRate >= FRAUD_RATE_THRESHOLD;

  return {
    isFraudRisk,
    fraudRate: Number(fraudRate.toFixed(4)),
    conversionRate: Number(conversionRate.toFixed(4)),
  };
}

/**
 * Evaluates top vendor eligibility from completed weekly outflow goals.
 * Accepted counts remain as ranking/context metrics, not as the top gate.
 */
function computeTopEligibility(
  snapshots,
  classificationWeeklyResults,
  goalCompensation,
) {
  const cutoff = getLastDaysStart(TOP_CONVERSION_WINDOW_DAYS);

  const recentWindowSnapshots = snapshots.filter((s) => {
    if (!s.case_created_at) return false;
    const d = new Date(s.case_created_at);
    return d >= cutoff;
  });

  const recentAccepted = recentWindowSnapshots.filter((s) =>
    isAcceptedCaseSnapshot(s),
  );
  const recentOutflow = recentWindowSnapshots.filter((s) =>
    Boolean(s.sent_date_2),
  );

  const acceptedCount = recentAccepted.length;
  const inflowCount = recentWindowSnapshots.length;
  const outflowCount = recentOutflow.length;
  const acceptedDaySet = new Set(
    recentAccepted.map(
      (s) => new Date(s.case_created_at).toISOString().split("T")[0],
    ),
  );

  const acceptedToInflowRatePercent =
    inflowCount > 0
      ? Number(((acceptedCount / inflowCount) * 100).toFixed(2))
      : 0;
  const acceptedToOutflowRatePercent =
    outflowCount > 0
      ? Number(((acceptedCount / outflowCount) * 100).toFixed(2))
      : 0;
  const meetsConversionThresholds =
    acceptedToInflowRatePercent > TOP_MIN_ACCEPTED_TO_INFLOW_RATE_PERCENT;

  const avgAcceptedPerDay = acceptedCount / TOP_CONVERSION_WINDOW_DAYS;
  const completedWeeksEvaluated = classificationWeeklyResults.length;
  const totalGoals = classificationWeeklyResults.reduce(
    (sum, weekResult) => sum + weekResult.goals.length,
    0,
  );
  const metGoals = classificationWeeklyResults.reduce(
    (sum, weekResult) =>
      sum + weekResult.goals.filter((goal) => goal.met).length,
    0,
  );
  const meetsCompletedWeeklyGoals = Boolean(
    goalCompensation?.eligibleAfterCompensation,
  );
  const isEligibleForTop =
    meetsCompletedWeeklyGoals && meetsConversionThresholds;

  return {
    isEligibleForTop,
    isEligibleToStayTop: isEligibleForTop,
    compensationApplied: Boolean(goalCompensation?.applied),
    meetsCompletedWeeklyGoals,
    meetsConversionThresholds,
    inflowCount,
    acceptedCount,
    outflowCount,
    acceptedDaysCount: acceptedDaySet.size,
    avgAcceptedPerDay: Number(avgAcceptedPerDay.toFixed(4)),
    conversionWindowDays: TOP_CONVERSION_WINDOW_DAYS,
    conversionWindowType: TOP_CONVERSION_WINDOW_TYPE,
    conversionWindowStart: cutoff.toISOString(),
    acceptedToInflowRatePercent,
    acceptedToOutflowRatePercent,
    minAcceptedToInflowRatePercent: TOP_MIN_ACCEPTED_TO_INFLOW_RATE_PERCENT,
    minAcceptedToOutflowRatePercent: null,
    completedWeeksEvaluated,
    totalGoals,
    metGoals,
    compensatedGoalMetCount: meetsCompletedWeeklyGoals ? totalGoals : metGoals,
    goalComplianceRate:
      totalGoals > 0 ? Number((metGoals / totalGoals).toFixed(4)) : null,
    compensatedGoalComplianceRate:
      totalGoals > 0
        ? Number(
            (
              (meetsCompletedWeeklyGoals ? totalGoals : metGoals) / totalGoals
            ).toFixed(4),
          )
        : null,
  };
}

function isProfileNewVendor(profile) {
  return Boolean(profile?.metrics_json?.vendorFreshness?.isNewVendor);
}

/** Runs all rule evaluations for a single vendor profile. */
function evaluateSingleVendor(profile) {
  const snapshots = profile.caseSnapshots || [];
  const activeAssignments = (profile.tortAssignments || []).filter(
    (a) => a.status === "active",
  );

  const weeklyResults = computeWeeklyGoalResults(activeAssignments, snapshots);
  const isNewVendor = isProfileNewVendor(profile);
  const classificationWeeklyResults =
    getClassificationWeeklyResults(weeklyResults);
  const newVendorProbation = buildNewVendorProbationStatus(
    isNewVendor,
    weeklyResults,
  );
  const goalCompensation = buildGoalCompensationSummary(
    classificationWeeklyResults,
    {
      windowWeeks: GOAL_CLASSIFICATION_COMPLETED_WEEKS,
    },
  );
  const consecutiveMissed = goalCompensation.eligibleAfterCompensation
    ? 0
    : countConsecutiveMissedWeeks(classificationWeeklyResults);
  const fraudRisk = computeFraudRisk(snapshots);
  const topEligibility = computeTopEligibility(
    snapshots,
    classificationWeeklyResults,
    goalCompensation,
  );
  const prevAlertFlags = profile.alert_flags || {};

  return {
    profileId: profile.id,
    profile,
    isNewVendor,
    weeklyResults,
    classificationWeeklyResults,
    newVendorProbation,
    goalCompensation,
    consecutiveMissed,
    fraudRisk,
    topEligibility,
    prevAlertFlags,
    // Will be populated by buildTop20Set
    newTopUnderperformWeeks: 0,
    newLastTopCheckWeek: prevAlertFlags.last_top_check_week || null,
  };
}

/**
 * Selects up to TOP_VENDOR_MAX vendors by accepted volume.
 * Prioritises existing top vendors to reduce category churn.
 * Tracks consecutive underperforming weeks for potential demotion.
 */
function buildTop20Set(evaluations, currentWeekStartStr) {
  const eligible = evaluations.filter(
    (e) =>
      isProfileCurrentlyActive(e.profile) && e.topEligibility.isEligibleForTop,
  );

  eligible.sort(
    (a, b) => b.topEligibility.acceptedCount - a.topEligibility.acceptedCount,
  );

  const currentTop = eligible.filter(
    (e) => e.profile.computed_category === "top_vendors",
  );
  const newCandidates = eligible.filter(
    (e) => e.profile.computed_category !== "top_vendors",
  );

  const combined = [...currentTop, ...newCandidates].slice(0, TOP_VENDOR_MAX);
  const top20Set = new Set(combined.map((e) => e.profileId));

  // Track underperforming weeks for current top vendors
  for (const e of evaluations) {
    const isCurrentlyTop = e.profile.computed_category === "top_vendors";
    if (!isCurrentlyTop) continue;

    const canSustain = e.topEligibility.isEligibleToStayTop;
    const prevWeeks = Number(e.prevAlertFlags.top_underperform_weeks || 0);
    const lastCheckWeek = e.prevAlertFlags.last_top_check_week || "";
    const isNewWeek = lastCheckWeek !== currentWeekStartStr;

    if (!canSustain) {
      e.newTopUnderperformWeeks = isNewWeek ? prevWeeks + 1 : prevWeeks;
      e.newLastTopCheckWeek = isNewWeek ? currentWeekStartStr : lastCheckWeek;

      // Force remove from top if underperform threshold is reached
      if (e.newTopUnderperformWeeks >= TOP_UNDERPERFORM_WEEKS_THRESHOLD) {
        top20Set.delete(e.profileId);
      }
    } else {
      e.newTopUnderperformWeeks = 0;
      e.newLastTopCheckWeek = currentWeekStartStr;
    }
  }

  return top20Set;
}

/** Determines the computed category for a vendor based on all evaluated rules. */
function determineComputedCategory(evaluation, top20Set) {
  const { fraudRisk, consecutiveMissed, isNewVendor } = evaluation;

  if (isNewVendor) return "new_vendor";

  if (fraudRisk.isFraudRisk) return "under_review";
  if (consecutiveMissed >= CONSECUTIVE_MISS_THRESHOLD) return "under_review";
  if (top20Set.has(evaluation.profileId)) return "top_vendors";

  return "under_review";
}

/** Builds a human-readable reason string for a category change. */
function buildChangeReason(evaluation, newCategory) {
  const {
    fraudRisk,
    consecutiveMissed,
    topEligibility,
    goalCompensation,
    isNewVendor,
  } = evaluation;

  if (newCategory === "under_review") {
    if (fraudRisk.isFraudRisk) {
      return (
        `Fraud/quality risk detected: ` +
        `${(fraudRisk.fraudRate * 100).toFixed(1)}% Fake Lead rate, ` +
        `${(fraudRisk.conversionRate * 100).toFixed(2)}% conversion rate`
      );
    }
    if (goalCompensation?.messageCode === "goal_compensation_insufficient") {
      return goalCompensation.message;
    }
    if (!topEligibility.meetsConversionThresholds) {
      return (
        `Top vendor conversion thresholds not met: ` +
        `${topEligibility.acceptedToInflowRatePercent}% accepted/inflow ` +
        `(min > ${topEligibility.minAcceptedToInflowRatePercent}%)`
      );
    }

    return (
      `Consecutive goal miss threshold reached: ` +
      `${consecutiveMissed} consecutive weeks with all assigned goals missed`
    );
  }

  if (newCategory === "top_vendors") {
    if (topEligibility.compensationApplied) {
      return (
        `Promoted to top_vendors: ${goalCompensation.message}. ` +
        `Conversion OK at ${topEligibility.acceptedToInflowRatePercent}% accepted/inflow. ` +
        `Informational accepted/outflow: ` +
        `${topEligibility.acceptedToOutflowRatePercent}% accepted/outflow`
      );
    }

    return (
      `Promoted to top_vendors: ` +
      `${topEligibility.metGoals}/${topEligibility.totalGoals} completed weekly outflow goals met, ` +
      `${topEligibility.acceptedToInflowRatePercent}% accepted/inflow. ` +
      `Informational accepted/outflow: ` +
      `${topEligibility.acceptedToOutflowRatePercent}% accepted/outflow`
    );
  }

  if (newCategory === "new_vendor") {
    if (isNewVendor) {
      return (
        evaluation.newVendorProbation?.message ||
        "New vendor detected from Salesforce Contact.CreatedDate"
      );
    }

    const underperformWeeks = evaluation.newTopUnderperformWeeks || 0;
    if (underperformWeeks >= TOP_UNDERPERFORM_WEEKS_THRESHOLD) {
      return `Demoted from top_vendors: ${underperformWeeks} consecutive underperforming weeks`;
    }
  }

  return "Category re-evaluated by automatic rules engine";
}

/** Builds the alert_flags JSON object to persist in vendor_profiles. */
function buildAlertFlags(evaluation, newCategory) {
  const {
    fraudRisk,
    consecutiveMissed,
    topEligibility,
    goalCompensation,
    newVendorProbation,
  } = evaluation;
  const underReviewProductivity = buildUnderReviewProductivityStatus(
    newCategory === "under_review" && !evaluation.isNewVendor,
    evaluation.weeklyResults,
  );

  return {
    // Goal tracking
    trending_to_under_review:
      newCategory !== "under_review" &&
      consecutiveMissed >= Math.max(1, CONSECUTIVE_MISS_THRESHOLD - 1),
    consecutive_missed_weeks: consecutiveMissed,

    // Fraud/quality tracking
    fraud_risk: fraudRisk.isFraudRisk,
    fraud_rate_pct: Number((fraudRisk.fraudRate * 100).toFixed(2)),
    conversion_rate_pct: Number((fraudRisk.conversionRate * 100).toFixed(2)),

    // Top vendor tracking
    trending_to_new_vendor:
      newCategory === "top_vendors" &&
      !topEligibility.isEligibleForTop &&
      (evaluation.newTopUnderperformWeeks || 0) > 0,
    top_underperform_weeks: evaluation.newTopUnderperformWeeks ?? 0,
    last_top_check_week:
      evaluation.newLastTopCheckWeek ??
      evaluation.prevAlertFlags.last_top_check_week ??
      null,

    // Performance summary
    accepted_28_days: topEligibility.acceptedCount,
    accepted_days_28: topEligibility.acceptedDaysCount,
    accepted_avg_per_day: topEligibility.avgAcceptedPerDay,
    top_conversion_window_days: topEligibility.conversionWindowDays || 0,
    top_conversion_window_type: topEligibility.conversionWindowType || null,
    top_conversion_window_start: topEligibility.conversionWindowStart || null,
    top_inflow_90_days: topEligibility.inflowCount || 0,
    top_accepted_90_days: topEligibility.acceptedCount || 0,
    top_outflow_90_days: topEligibility.outflowCount || 0,
    top_accepted_to_inflow_rate_pct:
      topEligibility.acceptedToInflowRatePercent || 0,
    top_accepted_to_outflow_rate_pct:
      topEligibility.acceptedToOutflowRatePercent || 0,
    top_min_accepted_to_inflow_rate_pct:
      topEligibility.minAcceptedToInflowRatePercent || 0,
    top_min_accepted_to_outflow_rate_pct:
      topEligibility.minAcceptedToOutflowRatePercent || 0,
    top_meets_conversion_thresholds: Boolean(
      topEligibility.meetsConversionThresholds,
    ),
    top_completed_weeks_evaluated: topEligibility.completedWeeksEvaluated,
    top_goal_met_count: topEligibility.metGoals,
    top_goal_total_count: topEligibility.totalGoals,
    top_goal_compliance_rate: topEligibility.goalComplianceRate,
    top_compensated_goal_met_count: topEligibility.compensatedGoalMetCount,
    top_compensated_goal_compliance_rate:
      topEligibility.compensatedGoalComplianceRate,

    // Completed-week balance compensation
    goal_compensation_enabled: Boolean(goalCompensation?.enabled),
    goal_compensation_mode: goalCompensation?.mode || null,
    goal_compensation_applied: Boolean(goalCompensation?.applied),
    goal_compensation_eligible: Boolean(
      goalCompensation?.eligibleAfterCompensation,
    ),
    goal_compensation_message_code: goalCompensation?.messageCode || null,
    goal_compensation_message: goalCompensation?.message || null,
    goal_compensation_window_weeks: goalCompensation?.windowWeeks || 0,
    goal_compensation_completed_weeks_evaluated:
      goalCompensation?.completedWeeksEvaluated || 0,
    goal_compensation_total_target: goalCompensation?.totalTarget || 0,
    goal_compensation_total_outflow: goalCompensation?.totalOutflow || 0,
    goal_compensation_total_deficit: goalCompensation?.totalDeficit || 0,
    goal_compensation_total_surplus: goalCompensation?.totalSurplus || 0,
    goal_compensation_by_tort: goalCompensation?.byTort || [],

    // New vendor completed-week probation
    new_vendor_probation_enabled: Boolean(newVendorProbation?.enabled),
    new_vendor_probation_trial_weeks: newVendorProbation?.trialWeeks || 0,
    new_vendor_probation_completed_weeks:
      newVendorProbation?.completedWeeksEvaluated || 0,
    new_vendor_probation_remaining_weeks:
      newVendorProbation?.remainingWeeks || 0,
    new_vendor_probation_trial_complete: Boolean(
      newVendorProbation?.trialComplete,
    ),
    new_vendor_probation_status: newVendorProbation?.status || null,
    new_vendor_probation_subcategory: newVendorProbation?.subcategory || null,
    new_vendor_probation_action_required: Boolean(
      newVendorProbation?.actionRequired,
    ),
    new_vendor_probation_should_deactivate: Boolean(
      newVendorProbation?.shouldDeactivate,
    ),
    new_vendor_probation_recommended_action:
      newVendorProbation?.recommendedAction || null,
    new_vendor_probation_message_code: newVendorProbation?.messageCode || null,
    new_vendor_probation_message: newVendorProbation?.message || null,
    new_vendor_probation_total_target: newVendorProbation?.totalTarget || 0,
    new_vendor_probation_total_outflow: newVendorProbation?.totalOutflow || 0,
    new_vendor_probation_total_deficit: newVendorProbation?.totalDeficit || 0,
    new_vendor_probation_total_surplus: newVendorProbation?.totalSurplus || 0,
    new_vendor_probation_by_tort: newVendorProbation?.byTort || [],
    new_vendor_probation_current_week:
      newVendorProbation?.currentWeekProgress || null,

    // Under review completed-week productivity check
    under_review_productivity_enabled: Boolean(
      underReviewProductivity?.enabled,
    ),
    under_review_productivity_review_weeks:
      underReviewProductivity?.reviewWeeks || 0,
    under_review_productivity_completed_weeks:
      underReviewProductivity?.completedWeeksEvaluated || 0,
    under_review_productivity_remaining_weeks:
      underReviewProductivity?.remainingWeeks || 0,
    under_review_productivity_review_complete: Boolean(
      underReviewProductivity?.reviewComplete,
    ),
    under_review_productivity_status: underReviewProductivity?.status || null,
    under_review_productivity_subcategory:
      underReviewProductivity?.subcategory || null,
    under_review_productivity_action_required: Boolean(
      underReviewProductivity?.actionRequired,
    ),
    under_review_productivity_should_deactivate: Boolean(
      underReviewProductivity?.shouldDeactivate,
    ),
    under_review_productivity_recommended_action:
      underReviewProductivity?.recommendedAction || null,
    under_review_productivity_message_code:
      underReviewProductivity?.messageCode || null,
    under_review_productivity_message: underReviewProductivity?.message || null,
    under_review_productivity_total_target:
      underReviewProductivity?.totalTarget || 0,
    under_review_productivity_total_outflow:
      underReviewProductivity?.totalOutflow || 0,
    under_review_productivity_total_deficit:
      underReviewProductivity?.totalDeficit || 0,
    under_review_productivity_total_surplus:
      underReviewProductivity?.totalSurplus || 0,
    under_review_productivity_by_tort: underReviewProductivity?.byTort || [],
    under_review_productivity_current_week:
      underReviewProductivity?.currentWeekProgress || null,
  };
}

function emitMonitoringAlerts(
  profile,
  oldCategory,
  newCategory,
  newAlertFlags,
) {
  const prevFlags = profile.alert_flags || {};
  const displayInfo = getProfileDisplayInfo(profile);
  const basePayload = {
    vendorId: profile.id,
    supplier: displayInfo.supplier,
    username: displayInfo.username,
    oldCategory,
    newCategory,
    categorySource: profile.category_source,
    alertFlags: newAlertFlags,
  };

  if (newCategory !== oldCategory) {
    publishVendorMonitoringAlert({
      type: "category_changed",
      severity: "high",
      message: `Vendor category changed from ${oldCategory || "none"} to ${newCategory}`,
      ...basePayload,
    });
  }

  if (
    !prevFlags.trending_to_under_review &&
    newAlertFlags.trending_to_under_review
  ) {
    publishVendorMonitoringAlert({
      type: "trending_to_under_review",
      severity: "medium",
      message: "Vendor is trending to under_review based on recent goal misses",
      ...basePayload,
    });
  }

  if (
    !prevFlags.trending_to_new_vendor &&
    newAlertFlags.trending_to_new_vendor
  ) {
    publishVendorMonitoringAlert({
      type: "trending_to_new_vendor",
      severity: "medium",
      message:
        "Top vendor is trending to new_vendor due to sustained underperformance",
      ...basePayload,
    });
  }

  if (!prevFlags.fraud_risk && newAlertFlags.fraud_risk) {
    publishVendorMonitoringAlert({
      type: "fraud_risk_detected",
      severity: "high",
      message: "Vendor has reached Fake Lead fraud risk threshold",
      ...basePayload,
    });
  }
}

// =============================================
// PERSISTENCE HELPERS
// =============================================

async function upsertWeeklyGoals(evaluation, transaction) {
  for (const weekResult of evaluation.weeklyResults) {
    for (const goal of weekResult.goals) {
      await VendorWeeklyGoal.upsert(
        {
          vendor_id: evaluation.profileId,
          product_id: goal.productId,
          week_start: weekResult.week.startStr,
          week_end: weekResult.week.endStr,
          weekly_target: goal.target,
          actual_inflow: goal.actual,
          actual_outflow: goal.actual,
          goal_met: goal.met,
        },
        { transaction },
      );
    }
  }
}

async function logCategoryChange(
  vendorId,
  fromCategory,
  toCategory,
  reason,
  transaction,
) {
  await VendorCategoryLog.create(
    {
      vendor_id: vendorId,
      from_category: fromCategory || null,
      to_category: toCategory,
      reason,
      triggered_by: "auto",
    },
    { transaction },
  );
}

/**
 * Creates or updates the top reward record for a vendor.
 * When leaving top category, deactivates all rewards.
 * When re-entering top, re-activates the record (rewards start empty).
 */
async function syncTopRewards(profile, isTop, transaction) {
  const existing = await VendorTopReward.findOne({
    where: { vendor_id: profile.id },
    transaction,
  });

  if (isTop && !existing) {
    await VendorTopReward.create(
      {
        vendor_id: profile.id,
        bonus_access: false,
        net_7: false,
        replacement_flexibility: false,
        auto_intake: false,
        active: true,
      },
      { transaction },
    );
  } else if (!isTop && existing && existing.active) {
    await existing.update(
      {
        active: false,
        bonus_access: false,
        net_7: false,
        replacement_flexibility: false,
        auto_intake: false,
      },
      { transaction },
    );
  } else if (isTop && existing && !existing.active) {
    await existing.update(
      {
        active: true,
        bonus_access: false,
        net_7: false,
        replacement_flexibility: false,
        auto_intake: false,
      },
      { transaction },
    );
  }
}

// =============================================
// MAIN ENTRY POINT
// =============================================

async function ensureVendorTopRewardColumns() {
  await VendorTopReward.sync();

  const tableDefinition = await sequelize
    .getQueryInterface()
    .describeTable("vendor_top_rewards");

  if (!tableDefinition.auto_intake) {
    await sequelize
      .getQueryInterface()
      .addColumn("vendor_top_rewards", "auto_intake", {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
  }
}

async function evaluateCategoryRules() {
  logger.info("VendorCategoryRules → evaluateCategoryRules() started");

  await ensureVendorTopRewardColumns();

  const profiles = await VendorProfile.findAll({
    include: [
      {
        model: Vendor,
        as: "vendorInfo",
        required: true,
        where: { status: "active" },
        attributes: ["id", "salesforce_id", "contact_name", "email", "status"],
      },
      {
        model: VendorTortAssignment,
        as: "tortAssignments",
        required: false,
        where: { status: "active" },
        include: [
          {
            model: Product,
            as: "product",
            attributes: ["id", "name"],
          },
        ],
      },
      {
        model: VendorCaseSnapshot,
        as: "caseSnapshots",
        attributes: [
          "product_id",
          "case_created_at",
          "signed_date",
          "sent_date_2",
          "sub_status",
        ],
        include: [
          {
            model: Product,
            as: "caseProduct",
            attributes: ["id", "name"],
            required: false,
          },
        ],
      },
    ],
  });

  if (!profiles.length) {
    logger.info("VendorCategoryRules → no active vendors to evaluate");
    return { evaluated: 0, changed: 0 };
  }

  const currentWeekStartStr = getCurrentWeekStartStr();
  const evaluations = profiles.map(evaluateSingleVendor);
  const top20Set = buildTop20Set(evaluations, currentWeekStartStr);

  let changed = 0;

  const transaction = await sequelize.transaction();
  try {
    for (const evaluation of evaluations) {
      const { profile } = evaluation;
      const newComputedCategory = determineComputedCategory(
        evaluation,
        top20Set,
      );
      const oldComputedCategory = profile.computed_category;

      // Upsert weekly goal records
      await upsertWeeklyGoals(evaluation, transaction);

      // Update profile fields
      const newAlertFlags = buildAlertFlags(evaluation, newComputedCategory);
      await profile.update(
        {
          computed_category: newComputedCategory,
          consecutive_missed_weeks: evaluation.consecutiveMissed,
          alert_flags: newAlertFlags,
        },
        { transaction },
      );

      emitMonitoringAlerts(
        profile,
        oldComputedCategory,
        newComputedCategory,
        newAlertFlags,
      );

      // Log category change
      if (newComputedCategory !== oldComputedCategory) {
        const reason = buildChangeReason(evaluation, newComputedCategory);
        await logCategoryChange(
          profile.id,
          oldComputedCategory,
          newComputedCategory,
          reason,
          transaction,
        );
        changed++;
      }

      // Manage top rewards lifecycle
      const isTop = newComputedCategory === "top_vendors";
      await syncTopRewards(profile, isTop, transaction);
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    logger.error(
      `VendorCategoryRules → evaluateCategoryRules() failed: ${err.message}`,
      { stack: err.stack },
    );
    throw err;
  }

  logger.info(
    `VendorCategoryRules → evaluateCategoryRules() done | evaluated: ${profiles.length} | changed: ${changed}`,
  );

  return { evaluated: profiles.length, changed };
}

module.exports = {
  evaluateCategoryRules,
  WEEKLY_OUTFLOW_TARGETS,
  CONSECUTIVE_MISS_THRESHOLD,
  TOP_VENDOR_MAX,
  TOP_UNDERPERFORM_WEEKS_THRESHOLD,
  TOP_CONVERSION_WINDOW_DAYS,
  TOP_CONVERSION_WINDOW_TYPE,
  TOP_MIN_ACCEPTED_TO_INFLOW_RATE_PERCENT,
};
