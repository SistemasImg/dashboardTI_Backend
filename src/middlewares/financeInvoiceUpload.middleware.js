const multer = require("multer");

const storage = multer.memoryStorage();

const financeInvoiceUpload = multer({
  storage,
  limits: {
    files: 1,
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const isPdf =
      file?.mimetype === "application/pdf" ||
      String(file?.originalname || "")
        .toLowerCase()
        .endsWith(".pdf");

    if (!isPdf) {
      const error = new Error("Only PDF files are allowed for invoicePdf");
      error.status = 400;
      return cb(error);
    }

    cb(null, true);
  },
});

module.exports = financeInvoiceUpload;
