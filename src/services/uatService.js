const UATtest = require("../models/uat");
const { Op } = require("sequelize");

async function createUAT(data) {
  return await UATtest.create(data);
}

async function getUAT(filters) {
  //console.log("filters", filters);
  const where = {};

  if (filters.test_type) where.test_type = filters.test_type;
  if (filters.name) where.name = filters.name;
  if (filters.result) where.result = filters.result;
  if (filters.tester_name) where.tester_name = filters.tester_name;

  if (filters.start_date || filters.end_date) {
    where.created_at = {};
    if (filters.start_date)
      where.created_at[Op.gte] = new Date(filters.start_date);
    if (filters.end_date) where.created_at[Op.lte] = new Date(filters.end_date);
  }

  return await UATtest.findAll({ where, order: [["created_at", "DESC"]] });
}

async function updateUAT(id, data) {
  const [updated] = await UATtest.update(data, { where: { id } });
  if (!updated) throw new Error("Test not found");
  return await UATtest.findByPk(id);
}

async function deleteUAT(id) {
  const deleted = await UATtest.destroy({ where: { id } });
  if (!deleted) throw new Error("Test not found");
  return deleted;
}

module.exports = {
  createUAT,
  getUAT,
  updateUAT,
  deleteUAT,
};
