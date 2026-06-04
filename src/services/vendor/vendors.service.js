const logger = require("../../utils/logger");
const sequelize = require("../../config/db");
const { Op } = require("sequelize");
const { authenticateSalesforce } = require("../salesforce/auth.service");
const {
  runSoqlQuery,
  patchSalesforceSObject,
  createSalesforceSObject,
} = require("../salesforce/client.service");
const {
  buildDashboardVendorsQuery,
} = require("../salesforce/queries/user.query");
const { mapDashboardVendor } = require("../salesforce/mappers/users.mapper");
const { Vendor, Product, VendorCountry } = require("../../models");

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

async function syncVendorsTableFromSalesforce() {
  logger.info("VendorsService → syncVendorsTableFromSalesforce() started");

  await ensureVendorsTable();

  const countryRows = await loadVendorCountries({ onlyActive: true });
  const countryByName = buildCountryMap(countryRows);

  const sf = await authenticateSalesforce();
  const raw = await runSoqlQuery(sf, buildDashboardVendorsQuery());
  const incoming = raw.map(mapDashboardVendor).filter(Boolean);

  let created = 0;
  let updated = 0;

  await sequelize.transaction(async (transaction) => {
    for (const vendor of incoming) {
      const normalizedCountry = normalizeCountryLookupKey(vendor.country);
      const countryRow = normalizedCountry
        ? countryByName.get(normalizedCountry)
        : null;
      const countryId = countryRow?.id || null;

      if (normalizedCountry && !countryId) {
        logger.warn(
          `VendorsService → syncVendorsTableFromSalesforce() country not found in vendors_country: "${vendor.country}"`,
        );
      }

      const existing = await Vendor.findOne({
        where: {
          salesforce_id: vendor.salesforceId,
        },
        transaction,
      });

      if (!existing) {
        await Vendor.create(
          {
            salesforce_id: vendor.salesforceId,
            name: vendor.name,
            contact_name: vendor.contactName,
            email: vendor.email,
            country_id: countryId,
            status: vendor.status,
            supplier_segment: null,
            tort_tier_statuses: [],
            posting_methods: [],
          },
          { transaction },
        );
        created += 1;
        continue;
      }

      await existing.update(
        {
          name: vendor.name,
          contact_name: vendor.contactName,
          email: vendor.email,
          country_id: countryId,
          status: vendor.status,
        },
        { transaction },
      );
      updated += 1;
    }
  });

  logger.success(
    `VendorsService → syncVendorsTableFromSalesforce() success | fetched: ${incoming.length} | created: ${created} | updated: ${updated}`,
  );

  return {
    fetched: incoming.length,
    created,
    updated,
  };
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

function normalizeStringOrNull(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
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

async function syncCountryToSalesforce({ salesforceUserId, country }) {
  const sf = await authenticateSalesforce();
  const escapedUserId = escapeSoqlString(salesforceUserId);

  logger.info(
    `VendorsService → syncCountryToSalesforce() querying User: ${salesforceUserId}`,
  );

  const rows = await runSoqlQuery(
    sf,
    `SELECT Id, ContactId FROM User WHERE Id = '${escapedUserId}' LIMIT 1`,
  );

  const user = rows?.[0];
  const contactId = user?.ContactId;

  logger.info(
    `VendorsService → syncCountryToSalesforce() User found: ${Boolean(user)} | ContactId: ${contactId || "none"}`,
  );

  if (!user) {
    const error = new Error(
      `Salesforce user not found for id: ${salesforceUserId}`,
    );
    error.status = 404;
    throw error;
  }

  if (!contactId) {
    const error = new Error(
      `Salesforce user ${salesforceUserId} has no linked ContactId. Country cannot be synced.`,
    );
    error.status = 400;
    throw error;
  }

  logger.info(
    `VendorsService → syncCountryToSalesforce() patching Contact ${contactId} Country__c = "${country}"`,
  );

  await patchSalesforceSObject(sf, "Contact", contactId, {
    Country__c: country,
  });

  logger.success(
    `VendorsService → syncCountryToSalesforce() success | contactId: ${contactId} | country: ${country}`,
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
  const nextCommunicationChannels = hasOwn(payload, "communicationChannel")
    ? normalizeCommunicationChannelsInput(payload.communicationChannel)
    : [];
  const nextTorts = normalizeTortsInput(payload.torts);
  const nextPostingMethods = normalizePostingMethodsInput(
    payload.postingMethods,
  );

  const hasCountry = hasOwn(payload, "country");
  const hasCountryId = hasOwn(payload, "countryId");
  const hasCommunicationChannel = hasOwn(payload, "communicationChannel");
  const hasTorts = hasOwn(payload, "torts");
  const hasPostingMethods = hasOwn(payload, "postingMethods");

  if (
    !hasCountry &&
    !hasCountryId &&
    !hasCommunicationChannel &&
    !hasTorts &&
    !hasPostingMethods
  ) {
    const error = new Error(
      "Nothing to update. Send at least one field: countryId, country, communicationChannel, torts, postingMethods",
    );
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

  if (hasCountry || hasCountryId) {
    await syncCountryToSalesforce({
      salesforceUserId: row.salesforce_id,
      country: nextCountryName,
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

  const contactName = String(payload.contactName || "").trim();
  const vendorName = String(payload.name || "").trim();
  const email = String(payload.email || "").trim();
  const status = String(payload.status || "active").toLowerCase();
  const communicationChannels = normalizeCommunicationChannelsInput(
    payload.communicationChannel,
  );
  const nextTorts = normalizeTortsInput(payload.torts);
  const nextPostingMethods = normalizePostingMethodsInput(
    payload.postingMethods,
  );

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

  // Check duplicate by email in local DB
  const existing = await Vendor.findOne({ where: { email } });
  if (existing) {
    const err = new Error(`A vendor with email "${email}" already exists`);
    err.status = 409;
    throw err;
  }

  // Split contactName into FirstName + LastName (first word / rest)
  const nameParts = contactName.split(/\s+/);
  const sfFirstName = nameParts.length > 1 ? nameParts[0] : "";
  const sfLastName =
    nameParts.length > 1 ? nameParts.slice(1).join(" ") : nameParts[0];

  logger.info(
    `VendorsService → createVendorTableEntry() creating SF Contact | contactName: ${contactName} | vendorName: ${vendorName}`,
  );

  const sf = await authenticateSalesforce();

  // 1. Fetch the fixed AccountId for "IMG Partner account"
  const imgAccountRows = await runSoqlQuery(
    sf,
    `SELECT Id FROM Account WHERE Name = 'IMG Partner account' LIMIT 1`,
  );

  if (!imgAccountRows?.length) {
    const err = new Error(
      'Salesforce Account "IMG Partner account" not found. Cannot create Contact.',
    );
    err.status = 502;
    throw err;
  }

  const sfAccountId = imgAccountRows[0].Id;
  logger.info(
    `VendorsService → createVendorTableEntry() IMG Partner account found: ${sfAccountId}`,
  );

  // 2. Create Contact in Salesforce
  const contactPayload = {
    FirstName: sfFirstName || undefined,
    LastName: sfLastName,
    AccountId: sfAccountId,
    Title: "Provider",
    Email: email,
    Supplier_segment__c: "New Review",
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
    const err = new Error(
      "Salesforce Contact creation did not return a valid id",
    );
    err.status = 502;
    throw err;
  }

  const sfContactId = sfContact.id;
  logger.info(
    `VendorsService → createVendorTableEntry() SF Contact created: ${sfContactId}`,
  );

  // 3. Create in local DB
  let newVendor;
  await sequelize.transaction(async (transaction) => {
    if (nextTorts && nextTorts.length) {
      await syncProductTiersByTorts(nextTorts, transaction);
    }

    newVendor = await Vendor.create(
      {
        salesforce_id: sfContactId,
        name: vendorName,
        contact_name: contactName,
        email,
        country_id: nextCountryId,
        status,
        supplier_segment: "New Review",
        communication_channel: serializeCommunicationChannels(
          communicationChannels,
        ),
        tort_tier_statuses: nextTorts || [],
        posting_methods: nextPostingMethods || [],
      },
      { transaction },
    );
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
    `VendorsService → createVendorTableEntry() success | id: ${newVendor.id} | sfContactId: ${sfContactId}`,
  );

  return toPublicVendor(refreshed || newVendor);
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
  syncVendorsTableFromSalesforce,
  listVendorsTable,
  listVendorsCountries,
  createVendorTableEntry,
  toggleVendorTableStatus,
  updateVendorsTableBulk,
  updateVendorsTableById,
};
