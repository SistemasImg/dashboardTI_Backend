const logger = require("../../utils/logger");

const {
  authenticateSalesforce,
} = require("../../services/salesforce/auth.service");
const { runSoqlQuery } = require("../../services/salesforce/client.service");

const {
  buildUsersQuery,
  buildSupplierAccountsQuery,
} = require("../../services/salesforce/queries/user.query");

const {
  mapUsersName,
  mapSupplierAccount,
} = require("../../services/salesforce/mappers/users.mapper");

async function getAllOwners() {
  logger.info("SalesforceOwnerService → getAllOwners() started");

  const sf = await authenticateSalesforce();

  const usersRecords = await runSoqlQuery(sf, buildUsersQuery());
  const usersData = usersRecords.map(mapUsersName);

  logger.success(
    `SalesforceOwnerService → getAllOwners() success | total: ${usersData.filter(Boolean).length}`,
  );

  return usersData;
}

async function getSupplierAccounts() {
  logger.info("SalesforceOwnerService → getSupplierAccounts() started");

  const sf = await authenticateSalesforce();

  const usersRecords = await runSoqlQuery(sf, buildSupplierAccountsQuery());
  const supplierAccounts = usersRecords.map(mapSupplierAccount).filter(Boolean);

  logger.success(
    `SalesforceOwnerService → getSupplierAccounts() success | total: ${supplierAccounts.length}`,
  );

  return supplierAccounts;
}

module.exports = {
  getAllOwners,
  getSupplierAccounts,
};
