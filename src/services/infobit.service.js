const axios = require("axios");
const https = require("https");
const logger = require("../utils/logger");
const jwt = require("jsonwebtoken");
const { MessageRecords, User, Agents } = require("../models");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

//CREATE MESSAGE INFOBIT
async function InfobitService(payload, user) {
  const decoded = jwt.verify(user, process.env.JWT_SECRET);
  const userId = decoded.id;
  const { dataValues } = await User.findByPk(userId);
  if (!dataValues) throw new Error("Usuario no encontrado");
  const agent = await Agents.findOne({
    where: { fullname: dataValues.fullname },
  });
  logger.info("InfobitService → InfobitService() started");
  console.log("Payload received in InfobitService:", payload);
  const { numberPhone, message } = payload;
  try {
    const { data } = await axios.post(
      "https://api.infobip.com/sms/3/messages",
      {
        messages: [
          {
            from: "+17576599670",
            destinations: [{ to: `+1${numberPhone}` }],
            content: {
              text: `${message}`,
            },
          },
        ],
      },
      {
        headers: {
          Authorization:
            "App 2418b40d853e9a5bcacc1b8978752985-37b0cfc5-b640-4b8c-a3ac-cf3d13ba13b9",
          "Content-Type": "application/json",
        },
        httpsAgent,
        timeout: 30000,
      },
    );
    logger.success("InfobitService → InfobitService() SUCCESS");
    const infoMessage = data.messages[0];
    const response = { bulkId: data.bulkId, ...infoMessage };
    await MessageRecords.create({
      numberphone: numberPhone,
      message,
      id_agent: agent.dataValues.id,
      bulkId: data.bulkId,
      messageId: response.messageId,
      groupName: response.status.groupName,
      status: response.status.name,
      description: response.status.description,
      groupId: response.status.groupId,
      id_extern: response.status.id,
    });

    logger.success("InfobitService → Message saved successfully");
    return response;
  } catch (error) {
    logger.error(
      "InfobitService → error",
      error.response?.data || error.message,
    );
    throw error;
  }
}

// LOG MESSAGE RECORDS
async function logMessageRecord(user) {
  logger.info("InfobitService → logMessageRecord() started");
  const decoded = jwt.verify(user, process.env.JWT_SECRET);
  const userId = decoded.id;
  const { dataValues } = await User.findByPk(userId);
  if (!dataValues) throw new Error("Usuario no encontrado");
  const agent = await Agents.findOne({
    where: { fullname: dataValues.fullname },
  });
  let recordMessage = await MessageRecords.findAll({
    raw: true,
    order: [["id", "DESC"]],
  });

  //Intake User Role Filtering
  if (decoded.role_id === 4 || decoded.role_id === 5) {
    if (recordMessage) {
      recordMessage = recordMessage.filter(
        (item) => item?.id_agent === agent.dataValues.id,
      );
    } else {
      logger.warn("InfobitService → No message records found");
      recordMessage = [];
    }
  }

  logger.success("InfobitService → logMessageRecord() OK");
  return recordMessage;
}

module.exports = {
  InfobitService,
  logMessageRecord,
};
