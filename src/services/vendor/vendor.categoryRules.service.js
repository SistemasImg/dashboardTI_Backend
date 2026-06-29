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

// Weekly outflow targets per tort type (sent/outflow cases/week)
const WEEKLY_OUTFLOW_TARGETS = {
  rideshare: 5,
  bardPort: 5,
  default: 2,
};

// Missing both completed evaluation weeks keeps/promotes under_review.
const CONSECUTIVE_MISS_THRESHOLD = 2;

// Quality/volume category constraints
const TOP_CONVERSION_WINDOW_DAYS = 90;
const TOP_CONVERSION_WINDOW_TYPE = "us_business_days";
const HQ_MIN_ACCEPTED_TO_INFLOW_RATE_PERCENT = 15;
const HV_MIN_TORT_GOAL_RATE_PERCENT = 50;

// Vendors qualify by HQ/HV. There is no top vendor count cap.

// Fraud/quality thresholds
// Only Fake Lead is treated as fraud signal.
const FRAUD_SUBSTATUS_VALUES = ["fake lead"];
const FRAUD_RATE_THRESHOLD = 0.2; // 20%+ of cases flagged as Fake Lead
const LOW_CONVERSION_THRESHOLD = 0.02; // less than 2% accepted

// Show current week + previous 3; classify only from the last 3 complete weeks.
const GOAL_DISPLAY_WEEKS = 4;
const GOAL_CLASSIFICATION_COMPLETED_WEEKS = 3;
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

function filterSnapshotsByAssignments(snapshots, assignments = []) {
  if (!Array.isArray(assignments) || assignments.length === 0) return [];

  return snapshots.filter((snapshot) =>
    assignments.some((assignment) => {
      const productName = String(assignment.product?.name || "").trim();
      return doesSnapshotMatchAssignment(snapshot, assignment, productName);
    }),
  );
}

function getSnapshotOutflowDate(snapshot) {
  return snapshot?.sent_date_2 || snapshot?.Sent_Date2__c || null;
}

function getSnapshotCreatedDate(snapshot) {
  return snapshot?.case_created_at || snapshot?.CreatedDate || null;
}

function isValidatedOutflowSnapshot(snapshot) {
  return Boolean(
    getSnapshotOutflowDate(snapshot) && snapshot?.outflow_validated,
  );
}

function isOutflowCaseSnapshot(snapshot) {
  return Boolean(getSnapshotOutflowDate(snapshot));
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
      if (!isValidatedOutflowSnapshot(s)) return false;
      const outflowDate = getSnapshotOutflowDate(s);
      const d = new Date(outflowDate);
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
    subcategory = "under_review_productivity_failed";
    messageCode = "under_review_productivity_failed";
    message = `Under review vendor failed ${GOAL_CLASSIFICATION_COMPLETED_WEEKS}-completed-week productivity goals: ${finalSummary.totalOutflow}/${finalSummary.totalTarget} outflow, deficit ${finalSummary.totalDeficit}.`;
    actionRequired = true;
    shouldDeactivate = false;
    recommendedAction = "review_vendor_assignments";
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

function buildCriticalVendorStatus(isCritical, weeklyResults, topEligibility) {
  if (!isCritical) {
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
  const reviewComplete =
    completedWeeksEvaluated >= GOAL_CLASSIFICATION_COMPLETED_WEEKS;
  const currentWeekProgress = buildCurrentWeekProgress(weeklyResults);

  const hqLow = !topEligibility.highQuality;
  const hvLow = !topEligibility.highVolume;

  let status;
  let subcategory;
  let messageCode;
  let message;
  let actionRequired = true;
  let shouldDeactivate = false;
  let recommendedAction = "deactivate_vendor";

  // Caso 1: vendor sin torts activos — nunca puede generar outflow
  if (topEligibility.totalAssignedTorts === 0) {
    status = "no_torts";
    subcategory = "critical_no_torts";
    messageCode = "critical_no_torts";
    message = "Critical vendor has no active tort assignments.";
    shouldDeactivate = true;
    recommendedAction = "deactivate_vendor";
  } else if (reviewComplete && hasMixedTortPerformance(finalSummary)) {
    // Caso 2: review completa, algunos torts pasan pero HQ sigue bajo
    const failedTorts = getFailedTortNames(finalSummary);
    status = "tort_action_required";
    subcategory = "critical_tort_deactivation_required";
    messageCode = "critical_tort_deactivation_required";
    message =
      `Critical vendor with underperforming torts: ${formatTortList(failedTorts)}: ` +
      `${finalSummary.totalOutflow}/${finalSummary.totalTarget} outflow, ` +
      `deficit ${finalSummary.totalDeficit}.`;
    shouldDeactivate = false;
    recommendedAction = "deactivate_underperforming_torts";
  } else if (reviewComplete && !finalSummary.eligibleAfterCompensation) {
    // Caso 3: critical review completa y no cumple metas.
    status = "failed";
    subcategory = "critical_deactivation_required";
    messageCode = "critical_deactivation_required";
    message =
      `Critical vendor failed ${GOAL_CLASSIFICATION_COMPLETED_WEEKS}-week review: ` +
      `${finalSummary.totalOutflow}/${finalSummary.totalTarget} outflow, ` +
      `deficit ${finalSummary.totalDeficit}.`;
    shouldDeactivate = true;
    recommendedAction = "deactivate_vendor";
  } else if (hqLow && hvLow) {
    // Caso 4: semanas en curso — ambas métricas bajas
    status = "critical_low_hq_low_hv";
    subcategory = "critical_low_quality_low_volume";
    messageCode = "critical_low_quality_low_volume";
    message =
      `Critical vendor: low accepted/inflow ` +
      `(${topEligibility.acceptedToInflowRatePercent}%) ` +
      `and low volume ` +
      `(${topEligibility.qualifiedTortCount}/${topEligibility.totalAssignedTorts} torts).`;
    shouldDeactivate = false;
    recommendedAction = "improve_quality_and_volume";
  } else {
    // Fallback genérico mientras no hay semanas completas aún
    status = "pending";
    subcategory = "critical_pending";
    messageCode = "critical_pending";
    message = "Critical vendor pending full review window.";
    shouldDeactivate = false;
    recommendedAction = "monitor_vendor";
  }

  const summary = reviewComplete
    ? finalSummary
    : buildGoalCompensationSummary(reviewWeeks, {
        windowWeeks: Math.max(completedWeeksEvaluated, 1),
      });

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
    hqLow,
    hvLow,
    acceptedToInflowRatePercent: topEligibility.acceptedToInflowRatePercent,
    highVolumeRatePercent: topEligibility.highVolumeRatePercent,
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

  const acceptedCount = snapshots.filter((s) =>
    isAcceptedCaseSnapshot(s),
  ).length;
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
  activeAssignments = [],
) {
  const scopedSnapshots = filterSnapshotsByAssignments(
    snapshots,
    activeAssignments,
  );
  const cutoff = getLastDaysStart(TOP_CONVERSION_WINDOW_DAYS);

  const recentInflowSnapshots = scopedSnapshots.filter((s) => {
    const createdDate = getSnapshotCreatedDate(s);
    if (!createdDate) return false;
    const d = new Date(createdDate);
    return d >= cutoff;
  });
  const recentAccepted = recentInflowSnapshots.filter((s) =>
    isAcceptedCaseSnapshot(s),
  );
  const recentOutflow = recentAccepted.filter((s) => {
    if (!isOutflowCaseSnapshot(s)) return false;
    const outflowDate = new Date(getSnapshotOutflowDate(s));
    return !Number.isNaN(outflowDate.getTime()) && outflowDate >= cutoff;
  });

  const acceptedCount = recentAccepted.length;
  const inflowCount = recentInflowSnapshots.length;
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
  const outflowToAcceptedRatePercent =
    acceptedCount > 0
      ? Number(((outflowCount / acceptedCount) * 100).toFixed(2))
      : 0;
  const highQuality =
    acceptedToInflowRatePercent > HQ_MIN_ACCEPTED_TO_INFLOW_RATE_PERCENT;

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
  const totalAssignedTorts = activeAssignments.length;
  const qualifiedTortCount = (goalCompensation?.byTort || []).filter(
    (item) => item.eligibleAfterCompensation,
  ).length;
  const highVolumeRatePercent =
    totalAssignedTorts > 0
      ? Number(((qualifiedTortCount / totalAssignedTorts) * 100).toFixed(2))
      : 0;
  const highVolume = highVolumeRatePercent > HV_MIN_TORT_GOAL_RATE_PERCENT;
  const isEligibleForTop = highQuality && highVolume;

  return {
    isEligibleForTop,
    isEligibleToStayTop: isEligibleForTop,
    compensationApplied: Boolean(goalCompensation?.applied),
    meetsCompletedWeeklyGoals,
    meetsConversionThresholds: highQuality,
    highQuality,
    highVolume,
    qualityStatus: highQuality ? "high" : "low",
    volumeStatus: highVolume ? "high" : "low",
    inflowCount,
    acceptedCount,
    outflowCount,
    acceptedDaysCount: acceptedDaySet.size,
    avgAcceptedPerDay: Number(avgAcceptedPerDay.toFixed(4)),
    conversionWindowDays: TOP_CONVERSION_WINDOW_DAYS,
    conversionWindowType: TOP_CONVERSION_WINDOW_TYPE,
    conversionWindowStart: cutoff.toISOString(),
    acceptedToInflowRatePercent,
    outflowToAcceptedRatePercent,
    minAcceptedToInflowRatePercent: HQ_MIN_ACCEPTED_TO_INFLOW_RATE_PERCENT,
    minOutflowToAcceptedRatePercent: null,
    totalAssignedTorts,
    qualifiedTortCount,
    highVolumeRatePercent,
    minHighVolumeRatePercent: HV_MIN_TORT_GOAL_RATE_PERCENT,
    highVolumeByTort: goalCompensation?.byTort || [],
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
  const fraudRisk = computeFraudRisk(
    filterSnapshotsByAssignments(snapshots, activeAssignments),
  );
  const topEligibility = computeTopEligibility(
    snapshots,
    classificationWeeklyResults,
    goalCompensation,
    activeAssignments,
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
  };
}

/** Determines the computed category for a vendor based on all evaluated rules. */
function determineComputedCategory(evaluation) {
  const { isNewVendor, topEligibility } = evaluation;

  if (isNewVendor) return "new_vendor";

  if (topEligibility.highQuality && topEligibility.highVolume) {
    return "top_vendors";
  }
  if (!topEligibility.highQuality && !topEligibility.highVolume) {
    return "critical_vendor";
  }

  return "under_review";
}

/** Builds a human-readable reason string for a category change. */
function buildChangeReason(evaluation, newCategory) {
  const { topEligibility, goalCompensation, isNewVendor } = evaluation;
  const hqText =
    `${topEligibility.acceptedToInflowRatePercent}% accepted/inflow ` +
    `(min > ${topEligibility.minAcceptedToInflowRatePercent}%)`;
  const hvText =
    `${topEligibility.qualifiedTortCount}/${topEligibility.totalAssignedTorts} tort goals met ` +
    `(${topEligibility.highVolumeRatePercent}%, ` +
    `min > ${topEligibility.minHighVolumeRatePercent}%)`;

  if (newCategory === "under_review") {
    return (
      `Mixed HQ/HV classification: ` +
      `HQ ${topEligibility.qualityStatus} (${hqText}), ` +
      `HV ${topEligibility.volumeStatus} (${hvText})`
    );
  }

  if (newCategory === "critical_vendor") {
    return (
      `Low HQ and low HV classification: ` +
      `HQ low (${hqText}), HV low (${hvText})`
    );
  }

  if (newCategory === "top_vendors") {
    if (topEligibility.compensationApplied) {
      return (
        `Promoted to top_vendors: ${goalCompensation.message}. ` +
        `HQ high at ${topEligibility.acceptedToInflowRatePercent}% accepted/inflow. ` +
        `HV high with ${hvText}. ` +
        `Informational outflow/accepted: ` +
        `${topEligibility.outflowToAcceptedRatePercent}% outflow/accepted`
      );
    }

    return (
      `Promoted to top_vendors: HQ high (${hqText}), HV high (${hvText}). ` +
      `Informational outflow/accepted: ` +
      `${topEligibility.outflowToAcceptedRatePercent}% outflow/accepted`
    );
  }

  if (newCategory === "new_vendor") {
    if (isNewVendor) {
      return (
        evaluation.newVendorProbation?.message ||
        "New vendor detected from Salesforce Contact.CreatedDate"
      );
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
  const criticalVendorStatus = buildCriticalVendorStatus(
    newCategory === "critical_vendor",
    evaluation.weeklyResults,
    topEligibility,
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

    // HQ/HV classification matrix
    classification_matrix: `${topEligibility.qualityStatus}_hq_${topEligibility.volumeStatus}_hv`,
    hq_enabled: true,
    hq_status: topEligibility.qualityStatus,
    hq_high_quality: Boolean(topEligibility.highQuality),
    hq_accepted_to_inflow_rate_pct:
      topEligibility.acceptedToInflowRatePercent || 0,
    hq_min_accepted_to_inflow_rate_pct:
      topEligibility.minAcceptedToInflowRatePercent || 0,
    hv_enabled: true,
    hv_status: topEligibility.volumeStatus,
    hv_high_volume: Boolean(topEligibility.highVolume),
    hv_passed_torts: topEligibility.qualifiedTortCount || 0,
    hv_total_torts: topEligibility.totalAssignedTorts || 0,
    hv_pass_rate_pct: topEligibility.highVolumeRatePercent || 0,
    hv_min_pass_rate_pct: topEligibility.minHighVolumeRatePercent || 0,
    hv_completed_weeks_evaluated: topEligibility.completedWeeksEvaluated || 0,
    hv_by_tort: topEligibility.highVolumeByTort || [],

    // Top vendor tracking
    trending_to_new_vendor: false,
    top_underperform_weeks: 0,
    last_top_check_week: null,

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
      topEligibility.outflowToAcceptedRatePercent || 0,
    top_outflow_to_accepted_rate_pct:
      topEligibility.outflowToAcceptedRatePercent || 0,
    top_min_accepted_to_inflow_rate_pct:
      topEligibility.minAcceptedToInflowRatePercent || 0,
    top_min_accepted_to_outflow_rate_pct:
      topEligibility.minOutflowToAcceptedRatePercent || 0,
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

    // Critical vendor review status
    critical_vendor_enabled: Boolean(criticalVendorStatus?.enabled),
    critical_vendor_review_weeks: criticalVendorStatus?.reviewWeeks || 0,
    critical_vendor_completed_weeks:
      criticalVendorStatus?.completedWeeksEvaluated || 0,
    critical_vendor_remaining_weeks: criticalVendorStatus?.remainingWeeks || 0,
    critical_vendor_review_complete: Boolean(
      criticalVendorStatus?.reviewComplete,
    ),
    critical_vendor_status: criticalVendorStatus?.status || null,
    critical_vendor_subcategory: criticalVendorStatus?.subcategory || null,
    critical_vendor_action_required: Boolean(
      criticalVendorStatus?.actionRequired,
    ),
    critical_vendor_should_deactivate: Boolean(
      criticalVendorStatus?.shouldDeactivate,
    ),
    critical_vendor_recommended_action:
      criticalVendorStatus?.recommendedAction || null,
    critical_vendor_message_code: criticalVendorStatus?.messageCode || null,
    critical_vendor_message: criticalVendorStatus?.message || null,
    critical_vendor_hq_low: Boolean(criticalVendorStatus?.hqLow),
    critical_vendor_hv_low: Boolean(criticalVendorStatus?.hvLow),
    critical_vendor_accepted_to_inflow_rate_pct:
      criticalVendorStatus?.acceptedToInflowRatePercent || 0,
    critical_vendor_hv_rate_pct:
      criticalVendorStatus?.highVolumeRatePercent || 0,
    critical_vendor_total_target: criticalVendorStatus?.totalTarget || 0,
    critical_vendor_total_outflow: criticalVendorStatus?.totalOutflow || 0,
    critical_vendor_total_deficit: criticalVendorStatus?.totalDeficit || 0,
    critical_vendor_total_surplus: criticalVendorStatus?.totalSurplus || 0,
    critical_vendor_by_tort: criticalVendorStatus?.byTort || [],
    critical_vendor_current_week:
      criticalVendorStatus?.currentWeekProgress || null,
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

async function ensureVendorCaseSnapshotOutflowValidatedColumn() {
  await VendorCaseSnapshot.sync();

  const tableDefinition = await sequelize
    .getQueryInterface()
    .describeTable("vendor_case_snapshots");

  if (!tableDefinition.outflow_validated) {
    await sequelize
      .getQueryInterface()
      .addColumn("vendor_case_snapshots", "outflow_validated", {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
  }
}

async function evaluateCategoryRules() {
  logger.info("VendorCategoryRules → evaluateCategoryRules() started");

  await ensureVendorTopRewardColumns();
  await ensureVendorCaseSnapshotOutflowValidatedColumn();

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
          "outflow_validated",
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

  const evaluations = profiles.map(evaluateSingleVendor);

  let changed = 0;

  const transaction = await sequelize.transaction();
  try {
    for (const evaluation of evaluations) {
      const { profile } = evaluation;
      const newComputedCategory = determineComputedCategory(evaluation);
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
  TOP_CONVERSION_WINDOW_DAYS,
  TOP_CONVERSION_WINDOW_TYPE,
  HQ_MIN_ACCEPTED_TO_INFLOW_RATE_PERCENT,
  HV_MIN_TORT_GOAL_RATE_PERCENT,
};
