const logger = require("../utils/logger");
const { Product } = require("../models");

const normalizeProductTiers = (tiersValue) => {
  if (tiersValue == null) return [];

  if (Array.isArray(tiersValue)) {
    return tiersValue.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof tiersValue === "string") {
    try {
      const parsed = JSON.parse(tiersValue);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch (error) {
      logger.warn(
        `ProductService → Invalid tiers JSON ignored: ${error.message}`,
      );
      return [];
    }
  }

  return [];
};

exports.allProducts = async () => {
  logger.info("ProductService → allProducts() started");

  const products = await Product.findAll({
    where: { status: 1 },
    raw: true,
  });

  if (!products || products.length === 0) {
    logger.warn("ProductService → No active products found (status = 1)");
    const err = new Error("No products found");
    err.status = 404;
    throw err;
  }

  const normalizedProducts = products.map((product) => ({
    ...product,
    tiers: normalizeProductTiers(product.tiers),
  }));

  logger.success("ProductService → allProducts() OK");
  return normalizedProducts;
};
