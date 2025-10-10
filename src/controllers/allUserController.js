const {
  getAllUsers,
  createUsers,
  updateUser,
  deleteUser,
} = require("../services/allUserServices");

async function allUsers(req, res) {
  try {
    const users = await getAllUsers();
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: "Error function allUsers", error });
  }
}

async function createUser(req, res) {
  try {
    const userCreate = await createUsers(req.body);
    res.status(201).json(userCreate);
  } catch (error) {
    res.status(500).json({ message: "Error function createUser", error });
  }
}

async function updateUsers(req, res) {
  try {
    const updatedUser = await updateUser(req.params.id, req.body);
    res.json(updatedUser);
  } catch (error) {
    console.error("error function updateUsers", error);
    res.status(404).json({ error: error.message });
  }
}

async function deleteUsers(req, res) {
  try {
    const updatedUser = await deleteUser(req.params.id);
    res.json(updatedUser);
  } catch (error) {
    console.error("error function deleteUsers", error);
    res.status(404).json({ error: error.message });
  }
}

module.exports = {
  allUsers,
  createUser,
  updateUsers,
  deleteUsers,
};
