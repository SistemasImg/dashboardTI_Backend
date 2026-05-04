const multer = require("multer");

const storage = multer.memoryStorage();

const chatbotUpload = multer({
  storage,
  limits: {
    files: 10,
    fileSize: 25 * 1024 * 1024,
  },
});

module.exports = chatbotUpload;
