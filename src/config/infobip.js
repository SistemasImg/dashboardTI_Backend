module.exports = {
  baseUrl: process.env.INFOBIP_BASE_URL || "https://api.infobip.com",
  apiKey: process.env.INFOBIP_API_KEY || "",
  sender: process.env.INFOBIP_SENDER || "",

  phoneLine: process.env.INFOBIP_CALL_PHONE || "",
  bookingUrl: process.env.INFOBIP_BOOKING_URL || "",
};
