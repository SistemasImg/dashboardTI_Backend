function startOfUtcDay(value = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function addUtcDays(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + Number(days));
  return startOfUtcDay(date);
}

function toDateKey(value) {
  const date = startOfUtcDay(value);
  return date ? date.toISOString().split("T")[0] : null;
}

function nthWeekdayOfMonth(year, monthIndex, weekday, nth) {
  const date = new Date(Date.UTC(year, monthIndex, 1));
  const offset = (weekday - date.getUTCDay() + 7) % 7;
  date.setUTCDate(1 + offset + (nth - 1) * 7);
  return startOfUtcDay(date);
}

function lastWeekdayOfMonth(year, monthIndex, weekday) {
  const date = new Date(Date.UTC(year, monthIndex + 1, 0));
  const offset = (date.getUTCDay() - weekday + 7) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return startOfUtcDay(date);
}

function observedFixedHoliday(year, monthIndex, day) {
  const actual = new Date(Date.UTC(year, monthIndex, day));
  const dayOfWeek = actual.getUTCDay();

  if (dayOfWeek === 6) return addUtcDays(actual, -1);
  if (dayOfWeek === 0) return addUtcDays(actual, 1);
  return startOfUtcDay(actual);
}

function addHoliday(holidays, value) {
  const key = toDateKey(value);
  if (key) holidays.add(key);
}

function buildUsFederalHolidaySetForYear(year) {
  const holidays = new Set();

  addHoliday(holidays, observedFixedHoliday(year, 0, 1));
  addHoliday(holidays, nthWeekdayOfMonth(year, 0, 1, 3));
  addHoliday(holidays, nthWeekdayOfMonth(year, 1, 1, 3));
  addHoliday(holidays, lastWeekdayOfMonth(year, 4, 1));

  if (year >= 2021) {
    addHoliday(holidays, observedFixedHoliday(year, 5, 19));
  }

  addHoliday(holidays, observedFixedHoliday(year, 6, 4));
  addHoliday(holidays, nthWeekdayOfMonth(year, 8, 1, 1));
  addHoliday(holidays, nthWeekdayOfMonth(year, 9, 1, 2));
  addHoliday(holidays, observedFixedHoliday(year, 10, 11));
  addHoliday(holidays, nthWeekdayOfMonth(year, 10, 4, 4));
  addHoliday(holidays, observedFixedHoliday(year, 11, 25));

  return holidays;
}

function getUsFederalHolidayKeysForDate(value) {
  const date = startOfUtcDay(value);
  if (!date) return new Set();

  const year = date.getUTCFullYear();
  const holidays = new Set();

  for (const holidayYear of [year - 1, year, year + 1]) {
    for (const key of buildUsFederalHolidaySetForYear(holidayYear)) {
      holidays.add(key);
    }
  }

  return holidays;
}

function isUsFederalHoliday(value) {
  const key = toDateKey(value);
  if (!key) return false;
  return getUsFederalHolidayKeysForDate(value).has(key);
}

function isUsBusinessDay(value) {
  const date = startOfUtcDay(value);
  if (!date) return false;

  const dayOfWeek = date.getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  return !isUsFederalHoliday(date);
}

function getUsBusinessDaysWindowStartDate(
  businessDays,
  referenceDate = new Date(),
) {
  const totalBusinessDays = Math.max(Number(businessDays) || 0, 1);
  let cursor = startOfUtcDay(referenceDate);
  let counted = 0;

  while (counted < totalBusinessDays) {
    if (isUsBusinessDay(cursor)) counted += 1;
    if (counted === totalBusinessDays) return cursor;
    cursor = addUtcDays(cursor, -1);
  }

  return cursor;
}

function toSalesforceDateTimeLiteral(value) {
  const date = startOfUtcDay(value);
  return date ? date.toISOString().replace(".000Z", "Z") : null;
}

module.exports = {
  getUsBusinessDaysWindowStartDate,
  isUsBusinessDay,
  isUsFederalHoliday,
  toDateKey,
  toSalesforceDateTimeLiteral,
};
