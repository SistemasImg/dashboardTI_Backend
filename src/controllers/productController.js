const { getAllProducts } = require("../services/productServices");

async function allProducts(req, res) {
  try {
    const products = await getAllProducts();
    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ message: "Error function allProducts", error });
  }
}

module.exports = {
  allProducts,
};
