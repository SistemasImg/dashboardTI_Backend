const Domain = require("../models/domain");

async function getAllDomains() {
  try {
    const domains = await Domain.findAll({
      where: { status: 1 },
      raw: true,
    });

    return domains;
  } catch (error) {
    console.error("error function getAllDomains", error);
  }
}

module.exports = {
  getAllDomains,
};
