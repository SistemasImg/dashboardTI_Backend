const logger = require("../../utils/logger");
const sequelize = require("../../config/db");
const { Op, DataTypes } = require("sequelize");
const { authenticateSalesforce } = require("../salesforce/auth.service");
const {
  runSoqlQuery,
  runToolingQuery,
  patchSalesforceSObject,
  createSalesforceSObject,
  deleteSalesforceSObject,
  getSalesforceToolingSObject,
  createSalesforceToolingSObject,
  patchSalesforceToolingSObject,
} = require("../salesforce/client.service");
const {
  buildDashboardVendorsQuery,
} = require("../salesforce/queries/user.query");
const { mapDashboardVendor } = require("../salesforce/mappers/users.mapper");
const {
  Vendor,
  Product,
  VendorCountry,
  VendorProfile,
  VendorTortAssignment,
  VendorCaseSnapshot,
  VendorWeeklyGoal,
  VendorCategoryLog,
  VendorTopReward,
} = require("../../models");

const SALESFORCE_DEFAULTS = {
  accountType: "Supplier",
  supplierSegment: "New Vendor",
  qualitySegment: "Average",
  contactTitle: "Provider",
  imgPartnerAccountId: "0018Y000031YBucQAG",
  imgPartnerAccountName: "IMG Partner account",
  partnerCommunityLicenseName: "Partner Community",
  permissionSetLabel: "Proveedor Users",
  flowLabelsBySource: {
    "Host & Post": "Assign Origin to a New Lead Follow Up sent by Host & Post",
    "Buffer Calls":
      "Assign Origin to a New Lead Follow Up sent by Buffer Calls",
    Campaign_p: "Assign Origin to a New Lead Follow Up sent by Campaign_p",
    supplier: "Assign Origin to a New Lead Follow Up sent by supplier",
    Transfer: "Assign Origin to a New Lead Follow Up sent by Transfer",
  },
};

function toPublicVendor(row) {
  const communicationChannels = parseCommunicationChannels(
    row.communication_channel,
  );

  return {
    id: row.id,
    salesforceId: row.salesforce_id,
    name: row.name,
    contactName: row.contact_name,
    email: row.email,
    countryId: row.country_id || row.countryInfo?.id || null,
    country: row.countryInfo?.name || null,
    status: row.status,
    reactivatedAt: row.reactivated_at || null,
    deactivatedAt: row.deactivated_at || null,
    lastStatusChangedAt: row.last_status_changed_at || null,
    supplierSegment: row.supplier_segment,
    communicationChannel: communicationChannels,
    tortTierStatuses: Array.isArray(row.tort_tier_statuses)
      ? row.tort_tier_statuses
      : [],
    postingMethods: Array.isArray(row.posting_methods)
      ? row.posting_methods
      : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureVendorsTable() {
  await Vendor.sync();
  await VendorCountry.sync();

  const queryInterface = sequelize.getQueryInterface();
  const tableDefinition = await queryInterface.describeTable("vendors");

  if (!tableDefinition.reactivated_at) {
    await queryInterface.addColumn("vendors", "reactivated_at", {
      type: DataTypes.DATE,
      allowNull: true,
    });
  }

  if (!tableDefinition.deactivated_at) {
    await queryInterface.addColumn("vendors", "deactivated_at", {
      type: DataTypes.DATE,
      allowNull: true,
    });
  }

  if (!tableDefinition.last_status_changed_at) {
    await queryInterface.addColumn("vendors", "last_status_changed_at", {
      type: DataTypes.DATE,
      allowNull: true,
    });
  }
}

function normalizeCountryLookupKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

async function loadVendorCountries({ onlyActive = true } = {}) {
  const where = onlyActive ? { status: true } : undefined;
  return VendorCountry.findAll({
    where,
    order: [
      ["name", "ASC"],
      ["id", "ASC"],
    ],
  });
}

function buildCountryMap(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = normalizeCountryLookupKey(row.name);
    if (key && !map.has(key)) {
      map.set(key, row);
    }
  }
  return map;
}

async function listVendorsTable() {
  await ensureVendorsTable();

  const rows = await Vendor.findAll({
    include: [
      {
        model: VendorCountry,
        as: "countryInfo",
        attributes: ["id", "name", "status"],
        required: false,
      },
    ],
    order: [
      [
        sequelize.literal(
          "CASE WHEN `Vendor`.`status` = 'active' THEN 0 ELSE 1 END",
        ),
        "ASC",
      ],
      [sequelize.col("Vendor.contact_name"), "ASC"],
      [sequelize.col("Vendor.name"), "ASC"],
      [sequelize.col("Vendor.id"), "ASC"],
    ],
  });

  const vendors = rows.map(toPublicVendor);
  return {
    summary: {
      total: vendors.length,
      active: vendors.filter((item) => item.status === "active").length,
      inactive: vendors.filter((item) => item.status === "inactive").length,
    },
    vendors,
  };
}

async function getVendorTableById(vendorId) {
  await ensureVendorsTable();

  const row = await Vendor.findByPk(vendorId, {
    include: [
      {
        model: VendorCountry,
        as: "countryInfo",
        attributes: ["id", "name", "status"],
        required: false,
      },
    ],
  });

  if (!row) {
    const error = new Error("Vendor not found");
    error.status = 404;
    throw error;
  }

  return toPublicVendor(row);
}

async function listVendorsCountries() {
  await ensureVendorsTable();

  const rows = await loadVendorCountries({ onlyActive: true });
  const countries = rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: Boolean(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return {
    total: countries.length,
    countries,
  };
}

async function fetchSalesforceVendors() {
  const sf = await authenticateSalesforce();
  const rows = await runSoqlQuery(sf, buildDashboardVendorsQuery());
  const vendors = (rows || []).map(mapDashboardVendor).filter(Boolean);

  return {
    rawCount: rows?.length || 0,
    vendors,
  };
}

async function listSalesforceVendors() {
  const { vendors } = await fetchSalesforceVendors();

  return {
    summary: {
      total: vendors.length,
      active: vendors.filter((item) => item.status === "active").length,
      inactive: vendors.filter((item) => item.status === "inactive").length,
    },
    vendors,
  };
}

function resolveVendorCountryId(
  countryName,
  countryByName,
  unresolvedCountries,
) {
  const normalizedCountry = normalizeStringOrNull(countryName);
  if (!normalizedCountry) return null;

  const countryRow = countryByName.get(
    normalizeCountryLookupKey(normalizedCountry),
  );

  if (!countryRow) {
    unresolvedCountries.add(normalizedCountry);
    return null;
  }

  return countryRow.id;
}

function valuesDiffer(currentValue, nextValue) {
  const current = currentValue == null ? null : String(currentValue).trim();
  const next = nextValue == null ? null : String(nextValue).trim();
  return current !== next;
}

async function syncSalesforceVendorsToMysql() {
  await ensureVendorsTable();

  const { rawCount, vendors: salesforceVendors } =
    await fetchSalesforceVendors();

  if (rawCount === 0 || salesforceVendors.length === 0) {
    const error = new Error(
      "Salesforce returned no vendors. Local sync aborted to avoid deleting vendors by mistake.",
    );
    error.status = 502;
    throw error;
  }

  const countryRows = await loadVendorCountries({ onlyActive: false });
  const countryByName = buildCountryMap(countryRows);
  const unresolvedCountries = new Set();

  const created = [];
  const updated = [];
  const deleted = [];
  let unchanged = 0;

  const salesforceById = new Map();
  for (const vendor of salesforceVendors) {
    const salesforceId = String(vendor.salesforceId || "").trim();
    if (!salesforceId || salesforceById.has(salesforceId)) continue;
    salesforceById.set(salesforceId, vendor);
  }

  await sequelize.transaction(async (transaction) => {
    const localRows = await Vendor.findAll({ transaction });
    const localBySalesforceId = new Map(
      localRows.map((row) => [String(row.salesforce_id || "").trim(), row]),
    );

    for (const [salesforceId, salesforceVendor] of salesforceById.entries()) {
      const nextCountryId = resolveVendorCountryId(
        salesforceVendor.country,
        countryByName,
        unresolvedCountries,
      );

      const nextValues = {
        name: normalizeStringOrNull(salesforceVendor.name),
        contact_name: normalizeStringOrNull(salesforceVendor.contactName),
        email: normalizeStringOrNull(salesforceVendor.email),
        country_id: nextCountryId,
        status: salesforceVendor.status === "inactive" ? "inactive" : "active",
      };

      const localRow = localBySalesforceId.get(salesforceId);
      if (!localRow) {
        const initialStatus =
          salesforceVendor.status === "inactive" ? "inactive" : "active";
        const newVendor = await Vendor.create(
          {
            salesforce_id: salesforceId,
            ...nextValues,
            status: initialStatus,
            reactivated_at: null,
            deactivated_at: initialStatus === "inactive" ? new Date() : null,
            last_status_changed_at: null,
            supplier_segment: null,
            communication_channel: null,
            tort_tier_statuses: [],
            posting_methods: [],
          },
          { transaction },
        );

        created.push({ id: newVendor.id, salesforceId });
        continue;
      }

      const updatePayload = {};
      if (valuesDiffer(localRow.name, nextValues.name)) {
        updatePayload.name = nextValues.name;
      }
      if (valuesDiffer(localRow.contact_name, nextValues.contact_name)) {
        updatePayload.contact_name = nextValues.contact_name;
      }
      if (valuesDiffer(localRow.email, nextValues.email)) {
        updatePayload.email = nextValues.email;
      }
      if ((localRow.country_id || null) !== (nextValues.country_id || null)) {
        updatePayload.country_id = nextValues.country_id;
      }
      if (localRow.status !== nextValues.status) {
        updatePayload.status = nextValues.status;
        updatePayload.last_status_changed_at = new Date();

        if (localRow.status === "inactive" && nextValues.status === "active") {
          updatePayload.reactivated_at = new Date();
        }

        if (localRow.status === "active" && nextValues.status === "inactive") {
          updatePayload.deactivated_at = new Date();
        }
      }

      const changedFields = Object.keys(updatePayload);
      if (changedFields.length) {
        await localRow.update(updatePayload, { transaction });
        updated.push({ id: localRow.id, salesforceId, fields: changedFields });
      } else {
        unchanged += 1;
      }
    }

    for (const localRow of localRows) {
      const salesforceId = String(localRow.salesforce_id || "").trim();
      if (salesforceById.has(salesforceId)) continue;

      await localRow.destroy({ transaction });
      deleted.push({ id: localRow.id, salesforceId });
    }
  });

  logger.success(
    `VendorsService → syncSalesforceVendorsToMysql() success | created: ${created.length} | updated: ${updated.length} | deleted: ${deleted.length} | unchanged: ${unchanged}`,
  );

  return {
    summary: {
      salesforceTotal: salesforceById.size,
      created: created.length,
      updated: updated.length,
      deleted: deleted.length,
      unchanged,
      unresolvedCountries: unresolvedCountries.size,
    },
    created,
    updated,
    deleted,
    unresolvedCountries: Array.from(unresolvedCountries).sort(),
  };
}

function normalizeStringOrNull(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function splitContactName(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    const error = new Error("contactName cannot be empty");
    error.status = 400;
    throw error;
  }

  const parts = normalized.split(/\s+/);
  if (parts.length === 1) {
    return {
      firstName: null,
      lastName: parts[0],
    };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function normalizeCommunicationChannelsInput(value) {
  if (value == null || value === "") return [];

  const rawList = Array.isArray(value) ? value : [value];
  const normalized = rawList
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  const dedup = [];
  const seen = new Set();
  for (const item of normalized) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(item);
  }

  if (dedup.length > 2) {
    const error = new Error("communicationChannel accepts at most 2 values");
    error.status = 400;
    throw error;
  }

  return dedup;
}

function serializeCommunicationChannels(list) {
  if (!Array.isArray(list) || !list.length) return null;
  return JSON.stringify(list);
}

function parseCommunicationChannels(value) {
  if (value == null || value === "") return [];

  const text = String(value).trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 2);
    }
  } catch (_error) {
    return [text];
  }

  return [text];
}

function escapeSoqlString(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

function toSalesforceDateOnly(value = new Date()) {
  return new Date(value).toISOString().split("T")[0];
}

function normalizeSalesforceNamePart(value) {
  const text = String(value || "").trim();
  return text || null;
}

function buildContactNameParts(payload = {}) {
  const split = splitContactName(payload.contactName || payload.name);
  const firstName =
    normalizeSalesforceNamePart(payload.firstName) || split.firstName;
  const lastName =
    normalizeSalesforceNamePart(payload.lastName) || split.lastName;

  if (!lastName) {
    const error = new Error(
      "lastName or contactName is required for Salesforce Contact",
    );
    error.status = 400;
    throw error;
  }

  return {
    salutation: normalizeSalesforceNamePart(payload.salutation),
    firstName,
    middleName: normalizeSalesforceNamePart(payload.middleName),
    lastName,
    suffix: normalizeSalesforceNamePart(payload.suffix),
  };
}

function buildSalesforceUserAlias(contactName, email) {
  const source = String(contactName || email || "vendor")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
  return (source || "vendor").slice(0, 8);
}

function buildSalesforceCommunityNickname(contactName, email) {
  const source = String(contactName || email || "vendor")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .slice(0, 30);
  return `${source || "vendor"}${Date.now().toString(36).slice(-6)}`;
}

async function assertNoLocalVendorDuplicate({
  email,
  vendorName,
  contactName,
}) {
  const existing = await Vendor.findOne({
    where: {
      [Op.or]: [{ email }, { name: vendorName }, { contact_name: contactName }],
    },
  });

  if (!existing) return null;

  const error = new Error("Vendor already exists in local database");
  error.status = 409;
  error.details = {
    id: existing.id,
    salesforceId: existing.salesforce_id,
    name: existing.name,
    contactName: existing.contact_name,
    email: existing.email,
    status: existing.status,
  };
  throw error;
}

async function getPartnerCommunityLicenseAvailability(sf) {
  const licenseName = escapeSoqlString(
    process.env.SALESFORCE_VENDOR_LICENSE_NAME ||
      SALESFORCE_DEFAULTS.partnerCommunityLicenseName,
  );
  const rows = await runSoqlQuery(
    sf,
    `SELECT Id, Name, TotalLicenses, UsedLicenses FROM UserLicense WHERE Name = '${licenseName}' LIMIT 1`,
  );
  const license = rows?.[0] || null;

  if (!license) {
    const error = new Error(`Salesforce UserLicense not found: ${licenseName}`);
    error.status = 502;
    throw error;
  }

  const total = Number(license.TotalLicenses || 0);
  const used = Number(license.UsedLicenses || 0);
  return {
    id: license.Id,
    name: license.Name,
    total,
    used,
    available: Math.max(total - used, 0),
  };
}

function assertPartnerCommunityLicenseAvailable(license) {
  if (license.available > 0) return;

  const error = new Error(
    `No Salesforce ${license.name} licenses available (${license.used}/${license.total} used)`,
  );
  error.status = 409;
  error.license = license;
  throw error;
}

async function resolveImgPartnerAccountId(sf) {
  const configuredAccountId =
    process.env.SALESFORCE_IMG_PARTNER_ACCOUNT_ID ||
    SALESFORCE_DEFAULTS.imgPartnerAccountId;

  if (configuredAccountId) {
    return configuredAccountId;
  }

  const accountName = escapeSoqlString(
    process.env.SALESFORCE_IMG_PARTNER_ACCOUNT_NAME ||
      SALESFORCE_DEFAULTS.imgPartnerAccountName,
  );
  const rows = await runSoqlQuery(
    sf,
    `SELECT Id, Name FROM Account WHERE Name = '${accountName}' LIMIT 1`,
  );

  if (!rows?.[0]?.Id) {
    const error = new Error(`Salesforce Account not found: ${accountName}`);
    error.status = 502;
    throw error;
  }

  return rows[0].Id;
}

async function resolvePartnerCommunityProfileId(sf) {
  if (process.env.SALESFORCE_VENDOR_PROFILE_ID) {
    return process.env.SALESFORCE_VENDOR_PROFILE_ID;
  }

  const profileName = normalizeStringOrNull(
    process.env.SALESFORCE_VENDOR_PROFILE_NAME,
  );
  const query = profileName
    ? `SELECT Id, Name FROM Profile WHERE Name = '${escapeSoqlString(profileName)}' LIMIT 1`
    : `SELECT Id, Name FROM Profile WHERE UserLicense.Name = '${escapeSoqlString(
        process.env.SALESFORCE_VENDOR_LICENSE_NAME ||
          SALESFORCE_DEFAULTS.partnerCommunityLicenseName,
      )}' LIMIT 1`;
  const rows = await runSoqlQuery(sf, query);

  if (!rows?.[0]?.Id) {
    const error = new Error(
      "Salesforce Profile for vendor user was not found. Configure SALESFORCE_VENDOR_PROFILE_ID if needed.",
    );
    error.status = 502;
    throw error;
  }

  return rows[0].Id;
}

async function resolveProveedorPermissionSetId(sf) {
  if (process.env.SALESFORCE_VENDOR_PERMISSION_SET_ID) {
    return process.env.SALESFORCE_VENDOR_PERMISSION_SET_ID;
  }

  const label = escapeSoqlString(
    process.env.SALESFORCE_VENDOR_PERMISSION_SET_LABEL ||
      SALESFORCE_DEFAULTS.permissionSetLabel,
  );
  const rows = await runSoqlQuery(
    sf,
    `SELECT Id, Name, Label FROM PermissionSet WHERE Label = '${label}' OR Name = 'Proveedor_Users' LIMIT 1`,
  );

  if (!rows?.[0]?.Id) {
    const error = new Error(`Salesforce PermissionSet not found: ${label}`);
    error.status = 502;
    throw error;
  }

  return rows[0].Id;
}

function normalizeFlowEnvKey(flowSource) {
  return String(flowSource || "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function resolveFlowLabel(flowSource) {
  const envKey = normalizeFlowEnvKey(flowSource);
  return (
    normalizeStringOrNull(
      process.env[`SALESFORCE_VENDOR_FLOW_${envKey}_LABEL`],
    ) ||
    SALESFORCE_DEFAULTS.flowLabelsBySource[flowSource] ||
    null
  );
}

function cloneFlowMetadata(metadata) {
  return JSON.parse(JSON.stringify(metadata || {}));
}

function getFlowFilterValue(filter) {
  if (!filter) return null;
  if (filter.value && typeof filter.value === "object") {
    return filter.value.stringValue || filter.value.value || null;
  }
  return filter.value || null;
}

function ensureOwnerIdFilter(metadata, userId) {
  const nextMetadata = cloneFlowMetadata(metadata);
  nextMetadata.start = nextMetadata.start || {};
  nextMetadata.start.filters = Array.isArray(nextMetadata.start.filters)
    ? nextMetadata.start.filters
    : [];

  const alreadyAssigned = nextMetadata.start.filters.some(
    (filter) =>
      String(filter?.field || "").toLowerCase() === "ownerid" &&
      String(getFlowFilterValue(filter) || "") === String(userId),
  );

  if (alreadyAssigned) {
    return { metadata: nextMetadata, changed: false };
  }

  nextMetadata.start.filters.push({
    field: "OwnerId",
    operator: "EqualTo",
    value: {
      stringValue: userId,
    },
  });

  const filterCount = nextMetadata.start.filters.length;
  if (filterCount > 1) {
    nextMetadata.start.filterLogic = Array.from(
      { length: filterCount },
      (_item, index) => String(index + 1),
    ).join(" OR ");
  }

  return { metadata: nextMetadata, changed: true };
}

async function findActiveFlowByLabel(sf, flowLabel) {
  const escapedFlowLabel = escapeSoqlString(flowLabel);
  const rows = await runToolingQuery(
    sf,
    `SELECT Id, DefinitionId, MasterLabel, VersionNumber, Status FROM Flow WHERE MasterLabel = '${escapedFlowLabel}' AND Status = 'Active' ORDER BY VersionNumber DESC LIMIT 1`,
  );

  return rows?.[0] || null;
}

async function assignOwnerIdToSalesforceFlow({ sf, flowSource, userId }) {
  if (!flowSource) {
    return {
      requested: false,
      source: null,
      status: "not_requested",
      message: null,
    };
  }

  const flowLabel = resolveFlowLabel(flowSource);
  if (!flowLabel) {
    return {
      requested: true,
      source: flowSource,
      status: "failed",
      message: `No Salesforce Flow label configured for source: ${flowSource}`,
    };
  }

  try {
    const activeFlow = await findActiveFlowByLabel(sf, flowLabel);
    if (!activeFlow?.Id) {
      return {
        requested: true,
        source: flowSource,
        flowLabel,
        status: "failed",
        message: `Active Salesforce Flow not found: ${flowLabel}`,
      };
    }

    const flowRecord = await getSalesforceToolingSObject(
      sf,
      "Flow",
      activeFlow.Id,
    );
    const fullName = flowRecord.FullName || flowRecord.DeveloperName;
    const metadata = flowRecord.Metadata || null;

    if (!fullName || !metadata?.start) {
      return {
        requested: true,
        source: flowSource,
        flowLabel,
        flowId: activeFlow.Id,
        status: "failed",
        message:
          "Salesforce Flow metadata did not include FullName or start filters.",
      };
    }

    const { metadata: nextMetadata, changed } = ensureOwnerIdFilter(
      metadata,
      userId,
    );

    if (!changed) {
      return {
        requested: true,
        source: flowSource,
        flowLabel,
        flowId: activeFlow.Id,
        status: "already_assigned",
        message: `OwnerId ${userId} already exists in the active Flow conditions.`,
      };
    }

    const createdFlow = await createSalesforceToolingSObject(sf, "Flow", {
      FullName: fullName,
      Metadata: nextMetadata,
    });
    const newFlowId = createdFlow?.id;

    if (!newFlowId) {
      return {
        requested: true,
        source: flowSource,
        flowLabel,
        flowId: activeFlow.Id,
        status: "failed",
        message: "Salesforce did not return a new Flow version id.",
      };
    }

    const newFlowRows = await runToolingQuery(
      sf,
      `SELECT Id, VersionNumber, Status FROM Flow WHERE Id = '${escapeSoqlString(
        newFlowId,
      )}' LIMIT 1`,
    );
    const newFlowVersion = newFlowRows?.[0]?.VersionNumber || null;

    if (activeFlow.DefinitionId && newFlowVersion) {
      await patchSalesforceToolingSObject(
        sf,
        "FlowDefinition",
        activeFlow.DefinitionId,
        {
          Metadata: {
            activeVersionNumber: Number(newFlowVersion),
          },
        },
      );
    }

    return {
      requested: true,
      source: flowSource,
      flowLabel,
      previousFlowId: activeFlow.Id,
      previousVersionNumber: activeFlow.VersionNumber,
      newFlowId,
      newVersionNumber: newFlowVersion,
      status: "assigned",
      message: `OwnerId ${userId} was added to ${flowLabel}.`,
    };
  } catch (error) {
    logger.warn(
      `VendorsService → assignOwnerIdToSalesforceFlow() failed: ${error.message}`,
    );
    return {
      requested: true,
      source: flowSource,
      flowLabel,
      status: "failed",
      message: error.message,
      salesforceErrors: error.salesforceErrors || null,
    };
  }
}

function normalizeTortsInput(tortsValue) {
  if (!tortsValue) return null;

  const list = Array.isArray(tortsValue) ? tortsValue : [tortsValue];

  return list
    .map((item) => ({
      tort: String(item?.tort || "").trim(),
      tier: String(item?.tier || "").trim(),
      status: String(item?.status || "active")
        .trim()
        .toLowerCase(),
    }))
    .filter((item) => item.tort && item.tier)
    .map((item) => ({
      tort: item.tort,
      tier: item.tier,
      status: ["active", "paused", "inactive"].includes(item.status)
        ? item.status
        : "active",
    }));
}

function normalizePostingMethodsInput(postingMethodsValue) {
  if (postingMethodsValue == null) return null;

  const list = Array.isArray(postingMethodsValue)
    ? postingMethodsValue
    : [postingMethodsValue];

  return list.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeTierArray(value) {
  if (value == null) return [];

  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch (_error) {
      return [];
    }
  }

  return [];
}

async function syncProductTiersByTorts(torts, transaction) {
  const tierByTort = new Map();

  for (const item of torts || []) {
    const tortName = String(item?.tort || "").trim();
    const tierName = String(item?.tier || "").trim();
    if (!tortName || !tierName) continue;

    const key = tortName.toLowerCase();
    if (!tierByTort.has(key)) {
      tierByTort.set(key, {
        tortName,
        tiers: new Set(),
      });
    }
    tierByTort.get(key).tiers.add(tierName);
  }

  if (!tierByTort.size) return;

  const tortNames = Array.from(tierByTort.values()).map(
    (item) => item.tortName,
  );
  const products = await Product.findAll({
    where: {
      name: {
        [Op.in]: tortNames,
      },
    },
    attributes: ["id", "name", "tiers"],
    transaction,
  });

  const productByName = new Map(
    products.map((item) => [
      String(item.name || "")
        .trim()
        .toLowerCase(),
      item,
    ]),
  );

  const missingTorts = [];
  for (const [key, value] of tierByTort.entries()) {
    if (!productByName.has(key)) {
      missingTorts.push(value.tortName);
    }
  }

  if (missingTorts.length) {
    const error = new Error(
      `Torts not found in products table: ${missingTorts.join(", ")}`,
    );
    error.status = 400;
    throw error;
  }

  for (const [key, value] of tierByTort.entries()) {
    const product = productByName.get(key);
    const currentTiers = normalizeTierArray(product.tiers);
    const currentTierSet = new Set(
      currentTiers.map((item) => item.toLowerCase()),
    );

    let changed = false;
    for (const tierName of value.tiers) {
      const normalized = tierName.toLowerCase();
      if (!currentTierSet.has(normalized)) {
        currentTiers.push(tierName);
        currentTierSet.add(normalized);
        changed = true;
      }
    }

    if (changed) {
      await product.update(
        {
          tiers: currentTiers,
        },
        { transaction },
      );
    }
  }
}

async function loadProductMapByTortNames(torts = [], transaction) {
  const tortNames = Array.from(
    new Set(
      (torts || [])
        .map((item) => String(item?.tort || "").trim())
        .filter(Boolean),
    ),
  );

  if (!tortNames.length) return new Map();

  const products = await Product.findAll({
    where: {
      name: {
        [Op.in]: tortNames,
      },
    },
    attributes: ["id", "name"],
    transaction,
  });

  return new Map(
    products.map((product) => [
      String(product.name || "")
        .trim()
        .toLowerCase(),
      product,
    ]),
  );
}

async function assertTortProductsExist(torts = []) {
  const tortNames = Array.from(
    new Set(
      (torts || [])
        .map((item) => String(item?.tort || "").trim())
        .filter(Boolean),
    ),
  );

  if (!tortNames.length) return;

  const products = await Product.findAll({
    where: {
      name: {
        [Op.in]: tortNames,
      },
    },
    attributes: ["name"],
  });
  const existingNames = new Set(
    products.map((item) =>
      String(item.name || "")
        .trim()
        .toLowerCase(),
    ),
  );
  const missingTorts = tortNames.filter(
    (name) => !existingNames.has(name.toLowerCase()),
  );

  if (missingTorts.length) {
    const error = new Error(
      `Torts not found in products table: ${missingTorts.join(", ")}`,
    );
    error.status = 400;
    throw error;
  }
}

async function createVendorClassificationLocals({
  localVendor,
  countryName,
  torts,
  transaction,
}) {
  const profile = await VendorProfile.create(
    {
      salesforce_user_id: localVendor.salesforce_id,
      username: localVendor.email || null,
      account: localVendor.name,
      supplier: localVendor.contact_name,
      country: countryName || null,
      supplier_segment: localVendor.supplier_segment || null,
      active: localVendor.status === "active",
      first_seen_at: new Date(),
      last_synced_at: new Date(),
      computed_category: "new_vendor",
      category_source: "auto",
      performance_score: 0,
      metrics_json: {
        source: {
          vendorsTableId: localVendor.id,
          createdBy: "api:POST /vendors",
        },
        vendorFreshness: {
          isNewVendor: true,
          windowDays: 30,
        },
      },
      consecutive_missed_weeks: 0,
      alert_flags: null,
    },
    { transaction },
  );

  const productByName = await loadProductMapByTortNames(torts, transaction);
  const assignments = [];

  for (const item of torts || []) {
    const product = productByName.get(
      String(item.tort || "")
        .trim()
        .toLowerCase(),
    );
    if (!product) continue;

    assignments.push(
      await VendorTortAssignment.create(
        {
          vendor_id: profile.id,
          product_id: Number(product.id),
          status: item.status || "active",
          notes: "Created from POST /vendors",
          assigned_by: null,
        },
        { transaction },
      ),
    );
  }

  return { profile, assignments };
}

async function resolveSalesforceContactContext(sf, salesforceRefId) {
  const refId = String(salesforceRefId || "").trim();
  if (!refId) {
    const error = new Error("Missing salesforce reference id");
    error.status = 400;
    throw error;
  }

  let userId = null;
  let contactId = null;

  if (refId.startsWith("003")) {
    contactId = refId;
  } else if (refId.startsWith("005")) {
    userId = refId;
    const escapedUserId = escapeSoqlString(refId);
    const userRows = await runSoqlQuery(
      sf,
      `SELECT Id, ContactId FROM User WHERE Id = '${escapedUserId}' LIMIT 1`,
    );

    const user = userRows?.[0];
    if (!user) {
      const error = new Error(`Salesforce user not found for id: ${refId}`);
      error.status = 404;
      throw error;
    }

    contactId = user.ContactId || null;
    if (!contactId) {
      const error = new Error(
        `Salesforce user ${refId} has no linked ContactId`,
      );
      error.status = 400;
      throw error;
    }
  } else {
    const escapedRefId = escapeSoqlString(refId);
    const contactRows = await runSoqlQuery(
      sf,
      `SELECT Id, AccountId, Parent_Account__c FROM Contact WHERE Id = '${escapedRefId}' LIMIT 1`,
    );
    if (contactRows?.[0]?.Id) {
      return {
        contactId: contactRows[0].Id,
        accountId: contactRows[0].AccountId || null,
        parentAccountId: contactRows[0].Parent_Account__c || null,
        userId,
      };
    }

    const userRows = await runSoqlQuery(
      sf,
      `SELECT Id, ContactId FROM User WHERE Id = '${escapedRefId}' LIMIT 1`,
    );

    const user = userRows?.[0];
    if (!user) {
      const error = new Error(
        `Salesforce record not found for reference id: ${refId}`,
      );
      error.status = 404;
      throw error;
    }

    contactId = user.ContactId || null;
    userId = user.Id;
    if (!contactId) {
      const error = new Error(
        `Salesforce user ${refId} has no linked ContactId`,
      );
      error.status = 400;
      throw error;
    }
  }

  const escapedContactId = escapeSoqlString(contactId);
  const contactRows = await runSoqlQuery(
    sf,
    `SELECT Id, AccountId, Parent_Account__c FROM Contact WHERE Id = '${escapedContactId}' LIMIT 1`,
  );

  const contact = contactRows?.[0];
  if (!contact) {
    const error = new Error(
      `Salesforce contact not found for id: ${contactId}`,
    );
    error.status = 404;
    throw error;
  }

  if (!userId) {
    const userRows = await runSoqlQuery(
      sf,
      `SELECT Id FROM User WHERE ContactId = '${escapedContactId}' LIMIT 2`,
    );

    if (userRows?.length === 1) {
      userId = userRows[0].Id;
    }
  }

  return {
    contactId: contact.Id,
    accountId: contact.AccountId || null,
    parentAccountId: contact.Parent_Account__c || null,
    userId,
  };
}

async function syncVendorIdentityToSalesforce({
  salesforceRefId,
  hasCountry,
  country,
  hasContactName,
  contactName,
  hasEmail,
  email,
  hasName,
  name,
}) {
  const sf = await authenticateSalesforce();
  const { contactId, accountId, parentAccountId, userId } =
    await resolveSalesforceContactContext(sf, salesforceRefId);

  if (hasName && !parentAccountId) {
    const error = new Error(
      `Vendor name cannot be synced to Account.Name because Contact ${contactId} has no Parent_Account__c.`,
    );
    error.status = 409;
    throw error;
  }

  // Patch Contact for contactName, email and country (one Contact per vendor, safe)
  const contactPatch = {};

  if (hasContactName) {
    const split = splitContactName(contactName);
    contactPatch.FirstName = split.firstName;
    contactPatch.LastName = split.lastName;
  }

  if (hasEmail) {
    contactPatch.Email = email;
  }

  if (hasCountry) {
    contactPatch.Country__c = country;
  }

  if (Object.keys(contactPatch).length > 0) {
    logger.info(
      `VendorsService → syncVendorIdentityToSalesforce() patching Contact ${contactId}`,
    );
    await patchSalesforceSObject(sf, "Contact", contactId, contactPatch);
  }

  if (hasName) {
    if (!userId) {
      const error = new Error(
        `Vendor name cannot be synced safely to Salesforce for Contact ${contactId}. No unique linked User was found.`,
      );
      error.status = 409;
      throw error;
    }

    logger.info(
      `VendorsService → syncVendorIdentityToSalesforce() patching User ${userId} CompanyName = "${name}"`,
    );
    await patchSalesforceSObject(sf, "User", userId, { CompanyName: name });

    logger.info(
      `VendorsService → syncVendorIdentityToSalesforce() patching Account ${parentAccountId} Name = "${name}" via Contact.Parent_Account__c`,
    );
    await patchSalesforceSObject(sf, "Account", parentAccountId, {
      Name: name,
    });
  }

  logger.success(
    `VendorsService → syncVendorIdentityToSalesforce() success | contactId: ${contactId} | accountId: ${accountId || "none"} | parentAccountId: ${parentAccountId || "none"} | userId: ${userId || "none"}`,
  );
}

async function updateVendorsTableById(vendorId, payload = {}) {
  await ensureVendorsTable();

  const row = await Vendor.findByPk(vendorId);
  if (!row) {
    const error = new Error("Vendor not found");
    error.status = 404;
    throw error;
  }

  const nextCountryText = normalizeStringOrNull(payload.country);
  const nextName = normalizeStringOrNull(payload.name);
  const nextContactName = normalizeStringOrNull(payload.contactName);
  const nextEmail = normalizeStringOrNull(payload.email);
  const nextCommunicationChannels = hasOwn(payload, "communicationChannel")
    ? normalizeCommunicationChannelsInput(payload.communicationChannel)
    : [];
  const nextTorts = normalizeTortsInput(payload.torts);
  const nextPostingMethods = normalizePostingMethodsInput(
    payload.postingMethods,
  );

  const hasCountry = hasOwn(payload, "country");
  const hasCountryId = hasOwn(payload, "countryId");
  const hasName = hasOwn(payload, "name");
  const hasContactName = hasOwn(payload, "contactName");
  const hasEmail = hasOwn(payload, "email");
  const hasCommunicationChannel = hasOwn(payload, "communicationChannel");
  const hasTorts = hasOwn(payload, "torts");
  const hasPostingMethods = hasOwn(payload, "postingMethods");

  if (
    !hasCountry &&
    !hasCountryId &&
    !hasName &&
    !hasContactName &&
    !hasEmail &&
    !hasCommunicationChannel &&
    !hasTorts &&
    !hasPostingMethods
  ) {
    const error = new Error(
      "Nothing to update. Send at least one field: name, contactName, email, countryId, country, communicationChannel, torts, postingMethods",
    );
    error.status = 400;
    throw error;
  }

  if (hasName && !nextName) {
    const error = new Error("name cannot be empty");
    error.status = 400;
    throw error;
  }

  if (hasContactName && !nextContactName) {
    const error = new Error("contactName cannot be empty");
    error.status = 400;
    throw error;
  }

  let nextCountryId = null;
  let nextCountryName = null;

  if (hasCountryId || hasCountry) {
    if (hasCountryId) {
      const rawCountryId = payload.countryId;
      if (rawCountryId == null || rawCountryId === "") {
        nextCountryId = null;
        nextCountryName = null;
      } else {
        const parsedCountryId = Number(rawCountryId);
        if (!Number.isInteger(parsedCountryId) || parsedCountryId <= 0) {
          const error = new Error("countryId must be a positive integer");
          error.status = 400;
          throw error;
        }

        const countryRow = await VendorCountry.findByPk(parsedCountryId);
        if (!countryRow) {
          const error = new Error(
            `Country not found in vendors_country for id: ${parsedCountryId}`,
          );
          error.status = 400;
          throw error;
        }

        nextCountryId = countryRow.id;
        nextCountryName = countryRow.name;
      }
    } else {
      if (!nextCountryText) {
        nextCountryId = null;
        nextCountryName = null;
      } else {
        const countryRows = await loadVendorCountries({ onlyActive: true });
        const countryByName = buildCountryMap(countryRows);
        const countryRow = countryByName.get(
          normalizeCountryLookupKey(nextCountryText),
        );

        if (!countryRow) {
          const error = new Error(
            `Country not found in vendors_country for name: ${nextCountryText}`,
          );
          error.status = 400;
          throw error;
        }

        nextCountryId = countryRow.id;
        nextCountryName = countryRow.name;
      }
    }
  }

  // Keep Salesforce in sync when identity fields are updated from this API.
  if (hasName || hasContactName || hasEmail || hasCountry || hasCountryId) {
    await syncVendorIdentityToSalesforce({
      salesforceRefId: row.salesforce_id,
      hasCountry: hasCountry || hasCountryId,
      country: nextCountryName,
      hasContactName,
      contactName: nextContactName,
      hasEmail,
      email: nextEmail,
      hasName,
      name: nextName,
    });
  }

  await sequelize.transaction(async (transaction) => {
    if (hasTorts) {
      await syncProductTiersByTorts(nextTorts || [], transaction);
    }

    const updatePayload = {};

    if (hasCountry || hasCountryId) {
      updatePayload.country_id = nextCountryId;
    }

    if (hasName) {
      updatePayload.name = nextName;
    }

    if (hasContactName) {
      updatePayload.contact_name = nextContactName;
    }

    if (hasEmail) {
      updatePayload.email = nextEmail;
    }

    if (hasCommunicationChannel) {
      updatePayload.communication_channel = serializeCommunicationChannels(
        nextCommunicationChannels,
      );
    }

    if (hasTorts) {
      updatePayload.tort_tier_statuses = nextTorts || [];
    }

    if (hasPostingMethods) {
      updatePayload.posting_methods = nextPostingMethods || [];
    }

    await row.update(updatePayload, { transaction });
  });

  const refreshed = await Vendor.findByPk(vendorId, {
    include: [
      {
        model: VendorCountry,
        as: "countryInfo",
        attributes: ["id", "name", "status"],
        required: false,
      },
    ],
  });

  return toPublicVendor(refreshed || row);
}

async function updateVendorsTableBulk(vendorIds = [], payload = {}) {
  await ensureVendorsTable();

  const ids = Array.isArray(vendorIds)
    ? vendorIds
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
    : [];

  const uniqueIds = Array.from(new Set(ids));
  if (!uniqueIds.length) {
    const error = new Error("vendorIds must contain at least one valid id");
    error.status = 400;
    throw error;
  }

  const updatePayload = { ...payload };
  delete updatePayload.vendorIds;

  const updated = [];
  const failed = [];

  for (const vendorId of uniqueIds) {
    try {
      const result = await updateVendorsTableById(vendorId, updatePayload);
      updated.push(result);
    } catch (error) {
      failed.push({
        vendorId,
        message: error.message,
        status: error.status || 500,
      });
    }
  }

  return {
    summary: {
      total: uniqueIds.length,
      updated: updated.length,
      failed: failed.length,
    },
    updated,
    failed,
  };
}

async function createVendorTableEntry(payload = {}) {
  await ensureVendorsTable();
  await VendorProfile.sync();
  await VendorTortAssignment.sync();

  const vendorName = String(payload.accountName || payload.name || "").trim();
  const email = String(payload.email || "").trim();
  const status = String(payload.status || "active").toLowerCase();
  const communicationChannels = normalizeCommunicationChannelsInput(
    payload.communicationChannel,
  );
  const nextTorts = normalizeTortsInput(payload.torts);
  const nextPostingMethods = normalizePostingMethodsInput(
    payload.postingMethods ?? payload.postingMethod,
  );
  const contactParts = buildContactNameParts(payload);
  const contactName =
    String(payload.contactName || "").trim() ||
    [contactParts.firstName, contactParts.lastName].filter(Boolean).join(" ");

  // Resolve country
  let nextCountryId = null;
  let nextCountryName = null;

  const hasCountryId = Object.prototype.hasOwnProperty.call(
    payload,
    "countryId",
  );
  const hasCountry = Object.prototype.hasOwnProperty.call(payload, "country");
  const nextCountryText = normalizeStringOrNull(payload.country);

  if (hasCountryId && payload.countryId != null && payload.countryId !== "") {
    const parsedId = Number(payload.countryId);
    const countryRow = await VendorCountry.findByPk(parsedId);
    if (!countryRow) {
      const err = new Error(
        `Country not found in vendors_country for id: ${parsedId}`,
      );
      err.status = 400;
      throw err;
    }
    nextCountryId = countryRow.id;
    nextCountryName = countryRow.name;
  } else if (hasCountry && nextCountryText) {
    const countryRows = await loadVendorCountries({ onlyActive: true });
    const countryByName = buildCountryMap(countryRows);
    const countryRow = countryByName.get(
      normalizeCountryLookupKey(nextCountryText),
    );
    if (!countryRow) {
      const err = new Error(
        `Country not found in vendors_country for name: ${nextCountryText}`,
      );
      err.status = 400;
      throw err;
    }
    nextCountryId = countryRow.id;
    nextCountryName = countryRow.name;
  }

  await assertNoLocalVendorDuplicate({ email, vendorName, contactName });
  await assertTortProductsExist(nextTorts || []);

  logger.info(
    `VendorsService → createVendorTableEntry() creating Salesforce vendor | contactName: ${contactName} | vendorName: ${vendorName}`,
  );

  const sf = await authenticateSalesforce();
  const license = await getPartnerCommunityLicenseAvailability(sf);
  assertPartnerCommunityLicenseAvailable(license);
  const imgAccountId = await resolveImgPartnerAccountId(sf);
  const profileId = await resolvePartnerCommunityProfileId(sf);
  const permissionSetId = await resolveProveedorPermissionSetId(sf);

  const accountPayload = {
    Name: vendorName,
    Type: SALESFORCE_DEFAULTS.accountType,
    Email__c: email,
    Supplier_segment__c: SALESFORCE_DEFAULTS.supplierSegment,
    Quality_segment__c: SALESFORCE_DEFAULTS.qualitySegment,
    Supplier_entry_date__c: toSalesforceDateOnly(),
    Active__c: true,
  };
  const sfAccount = await createSalesforceSObject(
    sf,
    "Account",
    accountPayload,
  );
  if (!sfAccount?.success || !sfAccount?.id) {
    const error = new Error(
      "Salesforce Account creation did not return a valid id",
    );
    error.status = 502;
    throw error;
  }
  const sfVendorAccountId = sfAccount.id;

  const contactPayload = {
    Salutation: contactParts.salutation || undefined,
    FirstName: contactParts.firstName || undefined,
    MiddleName: contactParts.middleName || undefined,
    LastName: contactParts.lastName,
    Suffix: contactParts.suffix || undefined,
    Parent_Account__c: sfVendorAccountId,
    AccountId: imgAccountId,
    Title: SALESFORCE_DEFAULTS.contactTitle,
    Supplier_segment__c: SALESFORCE_DEFAULTS.supplierSegment,
    Email: email,
  };

  if (nextCountryName) {
    contactPayload.Country__c = nextCountryName;
  }

  const sfContact = await createSalesforceSObject(
    sf,
    "Contact",
    contactPayload,
  );
  if (!sfContact?.success || !sfContact?.id) {
    const error = new Error(
      "Salesforce Contact creation did not return a valid id",
    );
    error.status = 502;
    throw error;
  }
  const sfContactId = sfContact.id;

  const userPayload = {
    ContactId: sfContactId,
    ProfileId: profileId,
    Username: email,
    Email: email,
    FirstName: contactParts.firstName || undefined,
    LastName: contactParts.lastName,
    Alias: buildSalesforceUserAlias(contactName, email),
    CommunityNickname: buildSalesforceCommunityNickname(contactName, email),
    TimeZoneSidKey:
      process.env.SALESFORCE_VENDOR_TIMEZONE || "America/Los_Angeles",
    LocaleSidKey: process.env.SALESFORCE_VENDOR_LOCALE || "en_US",
    EmailEncodingKey: process.env.SALESFORCE_VENDOR_EMAIL_ENCODING || "UTF-8",
    LanguageLocaleKey: process.env.SALESFORCE_VENDOR_LANGUAGE || "en_US",
    IsActive: status === "active",
  };
  const sfUser = await createSalesforceSObject(sf, "User", userPayload);
  if (!sfUser?.success || !sfUser?.id) {
    const error = new Error(
      "Salesforce User creation did not return a valid id",
    );
    error.status = 502;
    throw error;
  }
  const sfUserId = sfUser.id;

  const sfPermissionAssignment = await createSalesforceSObject(
    sf,
    "PermissionSetAssignment",
    {
      AssigneeId: sfUserId,
      PermissionSetId: permissionSetId,
    },
  );

  const flowAssignment = await assignOwnerIdToSalesforceFlow({
    sf,
    flowSource: payload.flowSource,
    userId: sfUserId,
  });

  let newVendor;
  let newProfile;
  let newAssignments = [];
  await sequelize.transaction(async (transaction) => {
    if (nextTorts && nextTorts.length) {
      await syncProductTiersByTorts(nextTorts, transaction);
    }

    newVendor = await Vendor.create(
      {
        salesforce_id: sfUserId,
        name: vendorName,
        contact_name: contactName,
        email,
        country_id: nextCountryId,
        status,
        supplier_segment: SALESFORCE_DEFAULTS.supplierSegment,
        communication_channel: serializeCommunicationChannels(
          communicationChannels,
        ),
        tort_tier_statuses: nextTorts || [],
        posting_methods: nextPostingMethods || [],
      },
      { transaction },
    );

    const localClassification = await createVendorClassificationLocals({
      localVendor: newVendor,
      countryName: nextCountryName,
      torts: nextTorts || [],
      transaction,
    });
    newProfile = localClassification.profile;
    newAssignments = localClassification.assignments;
  });

  const refreshed = await Vendor.findByPk(newVendor.id, {
    include: [
      {
        model: VendorCountry,
        as: "countryInfo",
        attributes: ["id", "name", "status"],
        required: false,
      },
    ],
  });

  logger.success(
    `VendorsService → createVendorTableEntry() success | id: ${newVendor.id} | sfUserId: ${sfUserId}`,
  );

  return {
    vendor: toPublicVendor(refreshed || newVendor),
    salesforce: {
      accountId: sfVendorAccountId,
      contactId: sfContactId,
      userId: sfUserId,
      imgPartnerAccountId: imgAccountId,
      permissionSetAssignmentId: sfPermissionAssignment?.id || null,
      license,
      flowAssignment,
    },
    classification: {
      profileId: newProfile?.id || null,
      assignments: newAssignments.map((item) => ({
        id: item.id,
        productId: item.product_id,
        status: item.status,
      })),
    },
  };
}

async function safelyDeleteSalesforceRecord(sf, objectName, recordId, deleted) {
  if (!recordId) return;

  try {
    await deleteSalesforceSObject(sf, objectName, recordId);
    deleted.push({ object: objectName, id: recordId, status: "deleted" });
  } catch (error) {
    if (error.status === 404) {
      deleted.push({ object: objectName, id: recordId, status: "not_found" });
      return;
    }
    throw error;
  }
}

function buildDeletedVendorEmail(recordId) {
  const suffix = String(recordId || Date.now())
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
  return `deleted.vendor.${suffix}@example.invalid`;
}

async function deleteOrAnonymizeSalesforceUser(sf, userId, deleted) {
  if (!userId) return;

  try {
    await safelyDeleteSalesforceRecord(sf, "User", userId, deleted);
    return;
  } catch (deleteError) {
    const deletedEmail = buildDeletedVendorEmail(userId);
    try {
      await patchSalesforceSObject(sf, "User", userId, {
        IsActive: false,
        Username: deletedEmail,
        Email: deletedEmail,
        FirstName: "Deleted",
        LastName: "Vendor",
        Alias: "delvend",
        CommunityNickname: `deleted${String(userId).slice(-8).toLowerCase()}`,
      });
      deleted.push({
        object: "User",
        id: userId,
        status: "deactivated_anonymized",
        reason: deleteError.message,
      });
    } catch (patchError) {
      patchError.message = `${deleteError.message}; fallback User anonymization failed: ${patchError.message}`;
      throw patchError;
    }
  }
}

async function deleteOrAnonymizeSalesforceContact(sf, contactId, deleted) {
  if (!contactId) return;

  try {
    await safelyDeleteSalesforceRecord(sf, "Contact", contactId, deleted);
    return;
  } catch (deleteError) {
    try {
      await patchSalesforceSObject(sf, "Contact", contactId, {
        FirstName: "Deleted",
        LastName: `Vendor ${String(contactId).slice(-6)}`,
        Email: buildDeletedVendorEmail(contactId),
      });
      deleted.push({
        object: "Contact",
        id: contactId,
        status: "anonymized",
        reason: deleteError.message,
      });
    } catch (patchError) {
      patchError.message = `${deleteError.message}; fallback Contact anonymization failed: ${patchError.message}`;
      throw patchError;
    }
  }
}

async function deleteOrAnonymizeSalesforceAccount(sf, accountId, deleted) {
  if (!accountId) return;

  try {
    await safelyDeleteSalesforceRecord(sf, "Account", accountId, deleted);
    return;
  } catch (deleteError) {
    if (deleteError.status === 404) {
      deleted.push({ object: "Account", id: accountId, status: "not_found" });
      return;
    }

    try {
      await patchSalesforceSObject(sf, "Account", accountId, {
        Name: `Deleted Vendor ${String(accountId).slice(-6)}`,
        Email__c: buildDeletedVendorEmail(accountId),
        Active__c: false,
      });
      deleted.push({
        object: "Account",
        id: accountId,
        status: "anonymized",
        reason: deleteError.message,
      });
    } catch (patchError) {
      patchError.message = `${deleteError.message}; fallback Account anonymization failed: ${patchError.message}`;
      throw patchError;
    }
  }
}

async function deleteSalesforceVendorRecords(sf, localVendor) {
  const salesforceContext = await resolveSalesforceContactContext(
    sf,
    localVendor.salesforce_id,
  );
  const { userId, contactId, parentAccountId } = salesforceContext;
  const deleted = [];

  if (userId) {
    const assignmentRows = await runSoqlQuery(
      sf,
      `SELECT Id FROM PermissionSetAssignment WHERE AssigneeId = '${escapeSoqlString(
        userId,
      )}'`,
    );

    for (const assignment of assignmentRows || []) {
      await safelyDeleteSalesforceRecord(
        sf,
        "PermissionSetAssignment",
        assignment.Id,
        deleted,
      );
    }

    await deleteOrAnonymizeSalesforceUser(sf, userId, deleted);
  }

  await deleteOrAnonymizeSalesforceContact(sf, contactId, deleted);
  await deleteOrAnonymizeSalesforceAccount(sf, parentAccountId, deleted);

  return {
    userId,
    contactId,
    accountId: parentAccountId,
    deleted,
  };
}

async function hardDeleteVendorTableEntry(vendorId) {
  await ensureVendorsTable();

  const row = await Vendor.findByPk(vendorId, {
    include: [
      {
        model: VendorProfile,
        as: "classificationProfile",
        required: false,
      },
    ],
  });

  if (!row) {
    const error = new Error("Vendor not found");
    error.status = 404;
    throw error;
  }

  const sf = await authenticateSalesforce();
  const salesforceDeletion = await deleteSalesforceVendorRecords(sf, row);
  const profileId = row.classificationProfile?.id || null;

  await sequelize.transaction(async (transaction) => {
    if (profileId) {
      await VendorTopReward.destroy({
        where: { vendor_id: profileId },
        transaction,
      });
      await VendorCategoryLog.destroy({
        where: { vendor_id: profileId },
        transaction,
      });
      await VendorWeeklyGoal.destroy({
        where: { vendor_id: profileId },
        transaction,
      });
      await VendorCaseSnapshot.destroy({
        where: { vendor_id: profileId },
        transaction,
      });
      await VendorTortAssignment.destroy({
        where: { vendor_id: profileId },
        transaction,
      });
      await VendorProfile.destroy({ where: { id: profileId }, transaction });
    }

    await row.destroy({ transaction });
  });

  logger.success(
    `VendorsService → hardDeleteVendorTableEntry() success | id: ${vendorId}`,
  );

  return {
    deleted: true,
    vendor: {
      id: row.id,
      salesforceId: row.salesforce_id,
      name: row.name,
      contactName: row.contact_name,
      email: row.email,
    },
    salesforce: salesforceDeletion,
    local: {
      vendorDeleted: true,
      profileId,
      relatedTablesCleared: Boolean(profileId),
    },
  };
}

async function toggleVendorTableStatus(vendorId, newStatus) {
  await ensureVendorsTable();

  const row = await Vendor.findByPk(vendorId);
  if (!row) {
    const err = new Error("Vendor not found");
    err.status = 404;
    throw err;
  }

  if (row.status === newStatus) {
    const err = new Error(`Vendor is already ${newStatus}`);
    err.status = 409;
    throw err;
  }

  const isActive = newStatus === "active";
  const sfId = String(row.salesforce_id || "");

  logger.info(
    `VendorsService → toggleVendorTableStatus() vendorId: ${vendorId} | sfId: ${sfId} | newStatus: ${newStatus}`,
  );

  const sf = await authenticateSalesforce();

  // salesforce_id starting with "005" = User, "003" = Contact (manually created vendor)
  if (sfId.startsWith("005")) {
    // Direct PATCH on User
    await patchSalesforceSObject(sf, "User", sfId, { IsActive: isActive });
    logger.info(
      `VendorsService → toggleVendorTableStatus() SF User.IsActive set to ${isActive}`,
    );
  } else if (sfId.startsWith("003")) {
    // Find the User linked to this Contact (if any)
    const escapedId = escapeSoqlString(sfId);
    const userRows = await runSoqlQuery(
      sf,
      `SELECT Id FROM User WHERE ContactId = '${escapedId}' LIMIT 1`,
    );

    const linkedUserId = userRows?.[0]?.Id;
    if (linkedUserId) {
      await patchSalesforceSObject(sf, "User", linkedUserId, {
        IsActive: isActive,
      });
      logger.info(
        `VendorsService → toggleVendorTableStatus() SF User linked to Contact updated | userId: ${linkedUserId} | IsActive: ${isActive}`,
      );
    } else {
      logger.warn(
        `VendorsService → toggleVendorTableStatus() No SF User found for ContactId: ${sfId}. Status updated in DB only.`,
      );
    }
  } else {
    logger.warn(
      `VendorsService → toggleVendorTableStatus() Unknown SF id prefix for: ${sfId}. Status updated in DB only.`,
    );
  }

  await row.update({ status: newStatus });

  const refreshed = await Vendor.findByPk(vendorId, {
    include: [
      {
        model: VendorCountry,
        as: "countryInfo",
        attributes: ["id", "name", "status"],
        required: false,
      },
    ],
  });

  logger.success(
    `VendorsService → toggleVendorTableStatus() success | vendorId: ${vendorId} | status: ${newStatus}`,
  );

  return toPublicVendor(refreshed || row);
}

module.exports = {
  listVendorsTable,
  getVendorTableById,
  listSalesforceVendors,
  syncSalesforceVendorsToMysql,
  listVendorsCountries,
  createVendorTableEntry,
  toggleVendorTableStatus,
  updateVendorsTableBulk,
  updateVendorsTableById,
  hardDeleteVendorTableEntry,
};
