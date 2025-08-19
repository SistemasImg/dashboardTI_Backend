const landingUatService = require("../services/landingUatService");

const didUatService = require("../services/didUatService");

//LANDING UAT
async function createTestLanding(req, res) {
  try {
    const newTest = await landingUatService.createLandingUAT(req.body);
    res.status(201).json(newTest);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

async function getTestLanding(req, res) {
  try {
    const testUat = await landingUatService.getLandingUAT(req.query);
    res.json(testUat);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function updateTestLanding(req, res) {
  try {
    const updatedTest = await landingUatService.updateLandingUAT(
      req.params.id,
      req.body
    );
    res.json(updatedTest);
  } catch (error) {
    console.error("error function updateTestLanding", error);
    res.status(404).json({ error: error.message });
  }
}

//DID UAT
async function createTestDid(req, res) {
  try {
    const newTest = await didUatService.createDidUAT(req.body);
    res.status(201).json(newTest);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

async function getTestDid(req, res) {
  try {
    const testUat = await didUatService.getDidUAT(req.query);
    res.json(testUat);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function updateTestDid(req, res) {
  try {
    const updatedTest = await didUatService.updateDidUAT(
      req.params.id,
      req.body
    );
    res.json(updatedTest);
  } catch (error) {
    console.error("error function updateTestDid", error);
    res.status(404).json({ error: error.message });
  }
}
module.exports = {
  createTestLanding,
  createTestDid,
  getTestLanding,
  getTestDid,
  updateTestLanding,
  updateTestDid,
};
