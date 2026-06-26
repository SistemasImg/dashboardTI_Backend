const { Op } = require("sequelize");
const EventEmitter = require("events");
const { Vendor, VendorProfile, VendorCategoryLog } = require("../../models");

const ALERT_EVENT = "vendor-monitoring-alert";
const MAX_BUFFERED_ALERTS = 1000;

const alertBus = new EventEmitter();
let alertSequence = 0;
const bufferedAlerts = [];

function normalizeLimit(value, fallback = 50, max = 200) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function toFinalCategory(profile) {
  const source = String(profile.category_source || "auto");
  const manual = profile.manual_category || null;
  if (source === "manual" && manual) return manual;
  return profile.computed_category;
}

function getProfileDisplayInfo(profile) {
  const vendorInfo = profile?.vendorInfo || null;
  return {
    supplier: vendorInfo?.contact_name || profile?.supplier || null,
    username: vendorInfo?.email || profile?.username || null,
  };
}

function publishVendorMonitoringAlert(payload) {
  alertSequence += 1;

  const event = {
    id: alertSequence,
    createdAt: new Date().toISOString(),
    ...payload,
  };

  bufferedAlerts.push(event);
  if (bufferedAlerts.length > MAX_BUFFERED_ALERTS) {
    bufferedAlerts.splice(0, bufferedAlerts.length - MAX_BUFFERED_ALERTS);
  }

  alertBus.emit(ALERT_EVENT, event);
  return event;
}

function getVendorMonitoringAlerts({ sinceId, limit } = {}) {
  const normalizedLimit = normalizeLimit(limit, 50, 500);
  const numericSinceId = Number(sinceId);

  const filtered = Number.isFinite(numericSinceId)
    ? bufferedAlerts.filter((item) => item.id > numericSinceId)
    : bufferedAlerts;

  const notifications = filtered.slice(-normalizedLimit);

  return {
    notifications,
    lastEventId: notifications.length
      ? notifications[notifications.length - 1].id
      : Number.isFinite(numericSinceId)
        ? numericSinceId
        : 0,
  };
}

function subscribeVendorMonitoringAlerts(listener) {
  alertBus.on(ALERT_EVENT, listener);

  return () => {
    alertBus.off(ALERT_EVENT, listener);
  };
}

async function getVendorMonitoringSummary(options = {}) {
  const limit = normalizeLimit(options.limit, 20, 100);

  const profiles = await VendorProfile.findAll({
    include: [
      {
        model: Vendor,
        as: "vendorInfo",
        required: true,
        where: { status: "active" },
        attributes: ["id", "salesforce_id", "contact_name", "email", "status"],
      },
    ],
    attributes: [
      "id",
      "supplier",
      "username",
      "computed_category",
      "category_source",
      "manual_category",
      "consecutive_missed_weeks",
      "alert_flags",
      "updated_at",
    ],
    order: [["updated_at", "DESC"]],
  });

  const byCategory = {
    new_vendor: 0,
    top_vendors: 0,
    under_review: 0,
    critical_vendor: 0,
  };

  const atRiskVendors = [];

  for (const profile of profiles) {
    const finalCategory = toFinalCategory(profile);
    if (byCategory[finalCategory] !== undefined) {
      byCategory[finalCategory] += 1;
    }

    const flags = profile.alert_flags || {};
    const hasRisk =
      Boolean(flags.fraud_risk) ||
      Boolean(flags.trending_to_under_review) ||
      Boolean(flags.trending_to_new_vendor);

    if (!hasRisk) continue;

    const displayInfo = getProfileDisplayInfo(profile);

    atRiskVendors.push({
      vendorId: profile.id,
      supplier: displayInfo.supplier,
      username: displayInfo.username,
      category: finalCategory,
      computedCategory: profile.computed_category,
      categorySource: profile.category_source,
      consecutiveMissedWeeks: Number(profile.consecutive_missed_weeks || 0),
      alertFlags: flags,
      updatedAt: profile.updated_at,
    });
  }

  atRiskVendors.sort((a, b) => {
    const scoreA =
      (a.alertFlags.fraud_risk ? 100 : 0) +
      (a.alertFlags.trending_to_under_review ? 10 : 0) +
      Number(a.consecutiveMissedWeeks || 0);
    const scoreB =
      (b.alertFlags.fraud_risk ? 100 : 0) +
      (b.alertFlags.trending_to_under_review ? 10 : 0) +
      Number(b.consecutiveMissedWeeks || 0);
    return scoreB - scoreA;
  });

  const recentCategoryChanges = await VendorCategoryLog.findAll({
    order: [["created_at", "DESC"]],
    limit,
    attributes: [
      "id",
      "vendor_id",
      "from_category",
      "to_category",
      "reason",
      "triggered_by",
      "created_at",
    ],
  });

  const vendorIds = [
    ...new Set(recentCategoryChanges.map((item) => Number(item.vendor_id))),
  ];

  const changeVendors = vendorIds.length
    ? await VendorProfile.findAll({
        where: { id: { [Op.in]: vendorIds } },
        include: [
          {
            model: Vendor,
            as: "vendorInfo",
            required: false,
            attributes: [
              "id",
              "salesforce_id",
              "contact_name",
              "email",
              "status",
            ],
          },
        ],
        attributes: ["id", "supplier", "username"],
      })
    : [];

  const changeVendorMap = new Map(
    changeVendors.map((item) => [Number(item.id), item]),
  );

  return {
    generatedAt: new Date().toISOString(),
    activeVendors: profiles.length,
    categoryCounts: byCategory,
    atRiskCount: atRiskVendors.length,
    atRiskVendors: atRiskVendors.slice(0, limit),
    recentCategoryChanges: recentCategoryChanges.map((item) => {
      const vendor = changeVendorMap.get(Number(item.vendor_id));
      const displayInfo = getProfileDisplayInfo(vendor);
      return {
        id: item.id,
        vendorId: Number(item.vendor_id),
        supplier: displayInfo.supplier,
        username: displayInfo.username,
        fromCategory: item.from_category,
        toCategory: item.to_category,
        reason: item.reason,
        triggeredBy: item.triggered_by,
        createdAt: item.created_at,
      };
    }),
  };
}

module.exports = {
  publishVendorMonitoringAlert,
  getVendorMonitoringAlerts,
  subscribeVendorMonitoringAlerts,
  getVendorMonitoringSummary,
};
