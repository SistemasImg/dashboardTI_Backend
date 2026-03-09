const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const customParseFormat = require("dayjs/plugin/customParseFormat");

dayjs.extend(utc);
dayjs.extend(customParseFormat);

/**
 * Normalize user date input into Salesforce UTC ISO range
 */
exports.normalizeDateRange = (startInput, endInput) => {
  try {
    const formats = [
      "YYYY-MM-DD",
      "YYYY/MM/DD",
      "DD/MM/YYYY",
      "MM/DD/YYYY",
      "DD/MM/YY",
      "MM/DD/YY",
    ];

    const start = dayjs(startInput, formats, true);
    const end = dayjs(endInput, formats, true);

    if (!start.isValid() || !end.isValid()) {
      throw new Error("INVALID_DATE_FORMAT");
    }

    const startUTC = start
      .utc()
      .startOf("day")
      .format("YYYY-MM-DDTHH:mm:ss[Z]");
    const endUTC = end
      .utc()
      .add(1, "day")
      .startOf("day")
      .format("YYYY-MM-DDTHH:mm:ss[Z]");

    return {
      startUTC,
      endUTC,
    };
  } catch (error) {
    console.error("Date normalization error:", error);
    throw error;
  }
};
