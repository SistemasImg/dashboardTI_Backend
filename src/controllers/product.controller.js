const logger = require("../utils/logger");
const productService = require("../services/product.service");

exports.allProducts = async (req, res, next) => {
  logger.info("ProductController → allProducts() called");

  try {
    const result = await productService.allProducts();

    logger.success("ProductController → allProducts() completed successfully");
    return res.json(result);
  } catch (error) {
    logger.error(`ProductController → allProducts() error: ${error.message}`);
    next(error);
  }
};
