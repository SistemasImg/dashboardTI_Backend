const User = require("../models/user");
const bcrypt = require("bcryptjs");

async function getAllUsers() {
  try {
    const results = await User.findAll({
      where: { status: "active" },
      raw: true,
      order: [["id", "DESC"]],
    });
    const formatDate = results.map((item) => ({
      ...item,
      created_at: formatDateToDDMMYYYY(item.created_at),
      updated_at: formatDateToDDMMYYYY(item.updated_at),
    }));
    console.log("Users retrieved successfully");
    return formatDate;
  } catch (error) {
    console.error("error function getAllUsers", error);
  }
}

async function createUsers(data) {
  try {
    const { password } = data;
    const passEncrypt = await bcrypt.hash(password, 10);
    const newUser = await User.create({ ...data, password: passEncrypt });
    console.log("New user created");
    return newUser;
  } catch (error) {
    console.error("Error creating user:", error);
    throw error;
  }
}

async function updateUser(id, data) {
  try {
    const { password } = data;
    const passEncrypt = await bcrypt.hash(password, 10);
    const dataUpdate = { ...data, password: passEncrypt };
    const [updated] = await User.update(dataUpdate, { where: { id } });
    if (!updated) throw new Error("User not found");
    const updatedRecord = await User.findByPk(id, { raw: true });
    if (!updatedRecord) throw new Error("User not found");
    return {
      ...updatedRecord,
      created_at: updatedRecord.created_at
        ? new Date(updatedRecord.created_at).toLocaleDateString("es-PE")
        : null,
      updated_at: updatedRecord.updated_at
        ? new Date(updatedRecord.updated_at).toLocaleDateString("es-PE")
        : null,
    };
  } catch (error) {
    console.error("Error updating user:", error);
    throw error;
  }
}

async function deleteUser(id) {
  try {
    const [updated] = await User.update(
      { status: "inactive" },
      { where: { id } }
    );
    if (!updated) throw new Error("User not found");
    const updatedRecord = await User.findByPk(id, { raw: true });
    if (!updatedRecord) throw new Error("User not found");
    return {
      ...updatedRecord,
      created_at: updatedRecord.created_at
        ? formatDateToDDMMYYYY(updatedRecord.created_at)
        : null,
      updated_at: updatedRecord.updated_at
        ? formatDateToDDMMYYYY(updatedRecord.updated_at)
        : null,
    };
  } catch (error) {
    console.error("Error setting user inactive:", error);
    throw error;
  }
}

function formatDateToDDMMYYYY(date) {
  if (!date) return null;
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

module.exports = {
  getAllUsers,
  createUsers,
  updateUser,
  deleteUser,
};
