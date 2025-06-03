const uatService = require("../services/uatService");

async function createTest(req, res) {
  try {
    const newTest = await uatService.createUAT(req.body);
    res.status(201).json(newTest);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

async function getTests(req, res) {
  try {
    const tests = await uatService.getUAT(req.query);
    res.json(tests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function updateTest(req, res) {
  try {
    const updatedTest = await uatService.updateUAT(req.params.id, req.body);
    res.json(updatedTest);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
}

async function deleteTest(req, res) {
  try {
    await uatService.deleteUAT(req.params.id);
    res.json({ message: "UAT Test deleted" });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
}

module.exports = {
  createTest,
  getTests,
  updateTest,
  deleteTest,
};
