const logger = require("../utils/logger");
const { Product } = require("../models");

exports.allProducts = async () => {
  logger.info("ProductService → allProducts() started");

  const products = await Product.findAll({
    where: { status: 1 }, // ← TU FILTRO ORIGINAL
    raw: true, // ← PARA DEVOLVER JSON PLANO (más rápido)
  });

  if (!products || products.length === 0) {
    logger.warn("ProductService → No active products found (status = 1)");
    const err = new Error("No products found");
    err.status = 404;
    throw err;
  }

  logger.success("ProductService → allProducts() OK");
  return products;
};
