const { getAllDomains } = require("../services/domainServices");

async function allDomains(req, res) {
  try {
    const domains = await getAllDomains();
    res.status(200).json(domains);
  } catch (error) {
    console.error("Error function allDomains", error);
    res.status(500).json({ message: "Error function allDomains", error });
  }
}

module.exports = {
  allDomains,
};
