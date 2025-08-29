const DidUat = require("../models/didUat");
const { Op } = require("sequelize");

async function createDidUAT(data) {
  try {
    // Lista de campos que SÍ van en la tabla
    const {
      nameRegister,
      testType,
      testerId,
      user,
      idProduct,
      uatType,
      contact,
      did,
      didDate,
      mode,
      cpaCpl,
      status,
      observations,
      checklist,
      // Los demás campos van a metric
      ...metricFields
    } = data;

    // Crea el objeto metric con los campos extra
    const metric = { ...metricFields };

    // Construye el objeto para guardar en la tabla
    const saveData = {
      nameRegister,
      testType,
      testerId,
      user,
      idProduct,
      uatType,
      contact,
      did,
      didDate,
      mode,
      cpaCpl,
      status,
      observations,
      checklist,
      metris: JSON.stringify(metric),
    };
    const newUAT = await DidUat.create(saveData);
    return newUAT;
  } catch (error) {
    console.error("Error creating UAT:", error);
    throw error;
  }
}

async function getDidUAT(filters = {}) {
  try {
    const where = {};
    if (filters.contact) where.contact = filters.contact;
    if (filters.did) where.did = filters.did;
    if (filters.user) where.user = filters.user;
    if (filters.testerId) where.testerId = filters.testerId;
    if (filters.idProduct) where.idProduct = filters.idProduct;
    if (filters.filterCreatedDate) {
      let [day, month, year] = filters.filterCreatedDate.split("/");
      if (day.length === 1) day = "0" + day;
      if (month.length === 1) month = "0" + month;
      const start = new Date(`${year}-${month}-${day}T00:00:00`);
      const end = new Date(`${year}-${month}-${day}T23:59:59`);
      where.created_at = { [Op.between]: [start, end] };
    }

    const results = await DidUat.findAll({
      where,
      raw: true,
      order: [["id", "DESC"]],
    });
    const formatDate = results.map((item) => ({
      ...item,
      didDate: formatDidDate(item.didDate),
      created_at: formatDateToDDMMYYYY(item.created_at),
      updated_at: formatDateToDDMMYYYY(item.updated_at),
    }));
    return formatDate;
  } catch (error) {
    console.error("Error fetching UATs:", error);
    throw error;
  }
}

async function updateDidUAT(id, data) {
  try {
    const [updated] = await DidUat.update(data, { where: { id } });
    if (!updated) throw new Error("Test not found");
    const updatedRecord = await DidUat.findByPk(id, { raw: true });
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

function formatDidDate(dateStr) {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split("-");
  if (!year || !month || !day) return dateStr;
  return `${day}-${month}-${year}`;
}

module.exports = {
  createDidUAT,
  getDidUAT,
  updateDidUAT,
};
