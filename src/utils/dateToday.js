const { DateTime } = require("luxon");

function getPeruDayRange(date = null) {
  const base = date
    ? DateTime.fromISO(date).setZone("America/Lima")
    : DateTime.now().setZone("America/Lima");

  const start = base.startOf("day").toUTC().toJSDate();
  const end = base.plus({ days: 1 }).startOf("day").toUTC().toJSDate();

  return { start, end };
}

module.exports = {
  getPeruDayRange,
};
