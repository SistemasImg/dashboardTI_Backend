const logger = require("../../utils/logger");

const {
  authenticateSalesforce,
} = require("../../services/salesforce/auth.service");
const { runSoqlQuery } = require("../../services/salesforce/client.service");

const {
  buildUsersQuery,
} = require("../../services/salesforce/queries/user.query");

const {
  mapUsersName,
} = require("../../services/salesforce/mappers/users.mapper");

async function getAllOwners() {
  const sf = await authenticateSalesforce();

  const usersRecords = await runSoqlQuery(sf, buildUsersQuery());
  const usersData = usersRecords.map(mapUsersName);
  return usersData;
}

module.exports = {
  getAllOwners,
};
