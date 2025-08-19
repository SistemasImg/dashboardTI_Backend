const landingUAT = require("../models/landingUat");
const { Op } = require("sequelize");

async function createLandingUAT(data) {
  try {
    const newUAT = await landingUAT.create(data);
    return newUAT;
  } catch (error) {
    console.error("Error creating UAT:", error);
    throw error;
  }
}

async function getLandingUAT(filters = {}) {
  try {
    const where = {};
    if (filters.user) where.user = filters.user;
    if (filters.idProduct) where.idProduct = filters.idProduct;
    if (filters.idDomain) where.idDomain = filters.idDomain;
    if (filters.testerId) where.testerId = filters.testerId;
    if (filters.filterCreatedDate) {
      let [day, month, year] = filters.filterCreatedDate.split("/");
      if (day.length === 1) day = "0" + day;
      if (month.length === 1) month = "0" + month;
      const start = new Date(`${year}-${month}-${day}T00:00:00`);
      const end = new Date(`${year}-${month}-${day}T23:59:59`);
      where.created_at = { [Op.between]: [start, end] };
    }

    const results = await landingUAT.findAll({
      where,
      raw: true,
      order: [["id", "DESC"]],
    });
    const formatDate = results.map((item) => ({
      ...item,
      created_at: formatDateToDDMMYYYY(item.created_at),
      updated_at: formatDateToDDMMYYYY(item.updated_at),
    }));
    return formatDate;
  } catch (error) {
    console.error("Error fetching UATs:", error);
    throw error;
  }
}

async function updateLandingUAT(id, data) {
  try {
    const [updated] = await landingUAT.update(data, { where: { id } });
    if (!updated) throw new Error("Test not found");
    const updatedRecord = await landingUAT.findByPk(id, { raw: true });
    if (!updatedRecord) throw new Error("Test not found");
    return {
      ...updatedRecord,
      created_at: updatedRecord.created_at
        ? new Date(updatedRecord.created_at).toLocaleDateString("es-PE")
        : null,
      updated_at: updatedRecord.updated_at
        ? new Date(updatedRecord.updated_at).toLocaleDateString("es-PE")
        : null,
    };
  } catch (error) {
    console.error("Error updating UAT:", error);
    throw error;
  }
}

function formatDateToDDMMYYYY(date) {
  if (!date) return null;
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

module.exports = {
  createLandingUAT,
  getLandingUAT,
  updateLandingUAT,
};
