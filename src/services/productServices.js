const Product = require("../models/products");

async function getAllProducts() {
  try {
    const products = await Product.findAll({
      where: { status: 1 },
      raw: true,
    });

    return products;
  } catch (error) {
    console.error("error function getAllProducts", error);
  }
}

module.exports = {
  getAllProducts,
};
