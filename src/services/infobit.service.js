const axios = require("axios");
const https = require("node:https");
const logger = require("../utils/logger");
const jwt = require("jsonwebtoken");
const { MessageRecords, User } = require("../models");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

//CREATE MESSAGE INFOBIT
async function InfobitService(payload, user) {
  const decoded = jwt.verify(user, process.env.JWT_SECRET);
  const userId = decoded.id;
  const { dataValues } = await User.findByPk(userId);
  if (!dataValues) throw new Error("Usuario no encontrado");
  logger.info("InfobitService → InfobitService() started");
  const { numberPhone, message } = payload;
  try {
    const { data } = await axios.post(
      "https://api.infobip.com/sms/3/messages",
      {
        messages: [
          {
            from: "+17576599670",
            destinations: [{ to: `+51${numberPhone}` }],
            content: {
              text: `${message}`,
            },
          },
        ],
      },
      {
        headers: {
          Authorization:
            "App 95cd9e5ab9b979b42403ef6d8ff68464-c833e533-3301-4d55-84a1-92520cef9647",
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
      id_agent: dataValues.id || 1,
      bulkId: data.bulkId,
      messageId: response.messageId,
      groupName: response.status.groupName,
      status: response.status.name,
      description: response.status.description,
      groupId: response.status.groupId,
      id_extern: response.status.id,
      direction: "OUTBOUND",
    });

    logger.success("InfobitService → Message saved successfully");
    return response;
  } catch (error) {
    logger.error(
      "InfobitService → error",
      error.response?.data || error.message,
    );
    console.error(error);
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
  let recordMessage = await MessageRecords.findAll({
    raw: true,
    order: [["id", "DESC"]],
  });

  //Intake User Role Filtering
  if (decoded.role_id === 4 || decoded.role_id === 5) {
    if (recordMessage) {
      recordMessage = recordMessage.filter(
        (item) => item?.id_agent === dataValues.id,
      );
    } else {
      logger.warn("InfobitService → No message records found");
      recordMessage = [];
    }
  }

  logger.success("InfobitService → logMessageRecord() OK");
  return recordMessage;
}

// UPDATED MESSAGE STATUS
async function updateMessageStatus(results) {
  for (const item of results) {
    await MessageRecords.update(
      {
        status: item.status.name,
        description: item.status.description,
        groupName: item.status.groupName,
      },
      {
        where: { messageId: item.messageId },
      },
    );
  }

  return { success: true };
}

//METHOD TO SAVE INBOUND MESSAGES
async function saveInboundMessages(results) {
  const messages = [];

  for (const msg of results) {
    const newMessage = await MessageRecords.create({
      numberphone: msg.from,
      message: msg.text,
      id_agent: null,
      bulkId: "inbound",
      messageId: `in_${Date.now()}`,
      groupName: "INBOUND",
      status: "RECEIVED",
      description: "Incoming message",
      groupId: 0,
      id_extern: 0,
      direction: "INBOUND",
    });

    messages.push(newMessage);
  }

  return messages;
}
module.exports = {
  InfobitService,
  logMessageRecord,
  updateMessageStatus,
  saveInboundMessages,
};
