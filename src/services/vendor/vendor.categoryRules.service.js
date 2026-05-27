/**
 * Vendor category rules engine.
 * Evaluates weekly inflow goals, fraud/quality conditions, and top vendor criteria.
 * Runs automatically after each vendor sync to keep categories and alerts current.
 */
const { Op } = require("sequelize");
const sequelize = require("../../config/db");
const logger = require("../../utils/logger");
const {
  VendorProfile,
  VendorTortAssignment,
  VendorCaseSnapshot,
  VendorWeeklyGoal,
  VendorCategoryLog,
  VendorTopReward,
  Product,
} = require("../../models");
const { publishVendorMonitoringAlert } = require("./vendor.alerts.service");

// =============================================
// RULE CONSTANTS
// =============================================

// Weekly inflow targets per tort type (cases/week)
const WEEKLY_INFLOW_TARGETS = {
  rideshare: 15,
  depo: 5,
  default: 10,
};

// More than 2 consecutive weeks missing all goals → under_review
const CONSECUTIVE_MISS_THRESHOLD = 3;

// Top vendor constraints
const TOP_VENDOR_MAX = 20;
const TOP_ACCEPTED_WINDOW_DAYS = 28;

// Minimum accepted avg/day in 28-day window to qualify for top
const TOP_ACCEPTED_DAILY_MIN = 1;

// Minimum to sustain top status (allows "intercalado" pattern)
const TOP_ACCEPTED_DAILY_SUSTAIN = 0.5;

// Consecutive underperforming weeks before demotion from top
const TOP_UNDERPERFORM_WEEKS_THRESHOLD = 4;

// Fraud/quality thresholds
// Only Fake Lead is treated as fraud signal.
const FRAUD_SUBSTATUS_VALUES = ["fake lead"];
const FRAUD_RATE_THRESHOLD = 0.2; // 20%+ of cases flagged as Fake Lead
const LOW_CONVERSION_THRESHOLD = 0.02; // less than 2% accepted

// How many complete weeks to evaluate for consecutive miss check
const GOAL_EVALUATION_WEEKS = 3;

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

// =============================================
// GOAL TARGET RESOLUTION
// =============================================

function getWeeklyInflowTarget(tortName) {
  const name = String(tortName || "").toLowerCase();
  if (name.includes("rideshare")) return WEEKLY_INFLOW_TARGETS.rideshare;
  if (name.includes("depo")) return WEEKLY_INFLOW_TARGETS.depo;
  return WEEKLY_INFLOW_TARGETS.default;
}

// =============================================
// EVALUATION FUNCTIONS
// =============================================

/**
 * Computes inflow counts and goal pass/fail for the last N complete ISO weeks.
 * Uses local snapshot data — no Salesforce call needed.
 */
function computeWeeklyGoalResults(assignments, snapshots) {
  if (!assignments.length) return [];

  const results = [];

  for (let w = 1; w <= GOAL_EVALUATION_WEEKS; w++) {
    const week = getWeekBoundaries(w);

    const weekSnapshots = snapshots.filter((s) => {
      if (!s.case_created_at) return false;
      const d = new Date(s.case_created_at);
      return d >= week.start && d <= week.end;
    });

    const goalResults = assignments.map((assignment) => {
      const productName = String(assignment.product?.name || "").trim();
      const target = getWeeklyInflowTarget(productName);

      const actualInflow = weekSnapshots.filter(
        (s) =>
          String(s.case_type || "")
            .trim()
            .toLowerCase() === productName.toLowerCase(),
      ).length;

      return {
        productId: assignment.product_id,
        productName,
        target,
        actual: actualInflow,
        met: actualInflow >= target,
      };
    });

    const allMissed =
      goalResults.length > 0 && goalResults.every((g) => !g.met);

    results.push({ week, weeksAgo: w, goals: goalResults, allMissed });
  }

  return results;
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
 * Evaluates top vendor eligibility and sustainability from snapshots.
 * Uses last 28 days (4 weeks) of accepted cases.
 */
function computeTopEligibility(snapshots) {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setUTCDate(now.getUTCDate() - TOP_ACCEPTED_WINDOW_DAYS);

  const recentAccepted = snapshots.filter((s) => {
    if (!s.signed_date) return false;
    const d = new Date(s.signed_date);
    return d >= cutoff;
  });

  const acceptedCount = recentAccepted.length;
  const acceptedDaySet = new Set(
    recentAccepted.map(
      (s) => new Date(s.signed_date).toISOString().split("T")[0],
    ),
  );

  const avgAcceptedPerDay = acceptedCount / TOP_ACCEPTED_WINDOW_DAYS;

  return {
    isEligibleForTop: avgAcceptedPerDay >= TOP_ACCEPTED_DAILY_MIN,
    isEligibleToStayTop: avgAcceptedPerDay >= TOP_ACCEPTED_DAILY_SUSTAIN,
    acceptedCount,
    acceptedDaysCount: acceptedDaySet.size,
    avgAcceptedPerDay: Number(avgAcceptedPerDay.toFixed(4)),
  };
}

/** Runs all rule evaluations for a single vendor profile. */
function evaluateSingleVendor(profile) {
  const snapshots = profile.caseSnapshots || [];
  const activeAssignments = (profile.tortAssignments || []).filter(
    (a) => a.status === "active",
  );

  const weeklyResults = computeWeeklyGoalResults(activeAssignments, snapshots);
  const consecutiveMissed = countConsecutiveMissedWeeks(weeklyResults);
  const fraudRisk = computeFraudRisk(snapshots);
  const topEligibility = computeTopEligibility(snapshots);
  const prevAlertFlags = profile.alert_flags || {};

  return {
    profileId: profile.id,
    profile,
    weeklyResults,
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
    (e) => e.profile.active && e.topEligibility.isEligibleForTop,
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
  const { fraudRisk, consecutiveMissed } = evaluation;

  if (fraudRisk.isFraudRisk) return "under_review";
  if (consecutiveMissed >= CONSECUTIVE_MISS_THRESHOLD) return "under_review";
  if (top20Set.has(evaluation.profileId)) return "top_vendors";

  return "new_review";
}

/** Builds a human-readable reason string for a category change. */
function buildChangeReason(evaluation, newCategory) {
  const { fraudRisk, consecutiveMissed, topEligibility } = evaluation;

  if (newCategory === "under_review") {
    if (fraudRisk.isFraudRisk) {
      return (
        `Fraud/quality risk detected: ` +
        `${(fraudRisk.fraudRate * 100).toFixed(1)}% Fake Lead rate, ` +
        `${(fraudRisk.conversionRate * 100).toFixed(2)}% conversion rate`
      );
    }
    return (
      `Consecutive goal miss threshold reached: ` +
      `${consecutiveMissed} consecutive weeks with all assigned goals missed`
    );
  }

  if (newCategory === "top_vendors") {
    return (
      `Promoted to top_vendors: ` +
      `${topEligibility.acceptedCount} accepted cases in last 28 days ` +
      `(avg ${topEligibility.avgAcceptedPerDay}/day)`
    );
  }

  if (newCategory === "new_review") {
    const underperformWeeks = evaluation.newTopUnderperformWeeks || 0;
    if (underperformWeeks >= TOP_UNDERPERFORM_WEEKS_THRESHOLD) {
      return `Demoted from top_vendors: ${underperformWeeks} consecutive underperforming weeks`;
    }
  }

  return "Category re-evaluated by automatic rules engine";
}

/** Builds the alert_flags JSON object to persist in vendor_profiles. */
function buildAlertFlags(evaluation, newCategory) {
  const { fraudRisk, consecutiveMissed, topEligibility } = evaluation;

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
    trending_to_new_review:
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
  };
}

function emitMonitoringAlerts(
  profile,
  oldCategory,
  newCategory,
  newAlertFlags,
) {
  const prevFlags = profile.alert_flags || {};
  const basePayload = {
    vendorId: profile.id,
    supplier: profile.supplier,
    username: profile.username,
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
    !prevFlags.trending_to_new_review &&
    newAlertFlags.trending_to_new_review
  ) {
    publishVendorMonitoringAlert({
      type: "trending_to_new_review",
      severity: "medium",
      message:
        "Top vendor is trending to new_review due to sustained underperformance",
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
      },
      { transaction },
    );
  }
}

// =============================================
// MAIN ENTRY POINT
// =============================================

async function evaluateCategoryRules() {
  logger.info("VendorCategoryRules → evaluateCategoryRules() started");

  const profiles = await VendorProfile.findAll({
    where: { active: true },
    include: [
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
          "case_type",
          "case_created_at",
          "signed_date",
          "sub_status",
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
  WEEKLY_INFLOW_TARGETS,
  CONSECUTIVE_MISS_THRESHOLD,
  TOP_VENDOR_MAX,
  TOP_UNDERPERFORM_WEEKS_THRESHOLD,
};
