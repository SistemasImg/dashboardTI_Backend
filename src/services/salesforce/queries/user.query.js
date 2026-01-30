function buildUsersQuery() {
  return `
    SELECT
      Id,
      Name
    FROM User
WHERE Contact.Name <> Null and Contact.Parent_Account__r.Name <> Null
  `;
}

module.exports = {
  buildUsersQuery,
};
