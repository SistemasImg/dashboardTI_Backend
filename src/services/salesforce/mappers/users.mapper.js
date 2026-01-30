function mapUsersName(user) {
  if (!user || !user.Name) return null;

  const name = user.Name.trim();
  if (!name) return null;

  if (name === "International Media Group") {
    user.Name = "Marketing Digital";
  }

  return { id: user.Id, name: user.Name };
}

module.exports = {
  mapUsersName,
};
