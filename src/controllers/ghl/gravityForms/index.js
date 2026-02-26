const ghlService = require("../../../services/ghl/gravityForms");

exports.sendToGHL = async (req, res) => {
  try {
    const result = await ghlService.upsertContact(req.body);
    res.status(200).json({ success: true, result });
  } catch (error) {
    console.error("GHL Error:", error.response?.data || error.message);
    res.status(500).json({ success: false, error: "Failed to send to GHL" });
  }
};
