const metrics = require("./metrics");
const logger = require("../../utils/logger");
const { askModel } = require("./ai.config");
const { systemPrompt } = require("./prompts");

exports.processMessage = async (userMessage) => {
  try {
    logger.info(`Incoming chatbot message: ${userMessage}`);

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    const response = await askModel(messages);
    const message = response.choices?.[0]?.message;

    if (!message) throw new Error("AI_INVALID_RESPONSE");

    // 🔥 If AI wants to call a function
    if (message.function_call) {
      const functionName = message.function_call.name;

      logger.info(`Function requested: ${functionName}`);

      let args;
      try {
        args = JSON.parse(message.function_call.arguments);
      } catch {
        throw new Error("INVALID_FUNCTION_ARGUMENTS");
      }

      let functionResult;

      switch (functionName) {
        case "getCaseByDate":
          functionResult = await metrics.sf.getCaseByDate(
            args.dateFilter === "today" ? "TODAY" : "YESTERDAY",
          );
          break;

        case "getCaseByNumber":
          functionResult = await metrics.sf.getCaseByNumber(args.caseNumber);
          break;

        case "getCaseByPhone":
          functionResult = await metrics.sf.getCaseByPhone(args.phone);
          break;

        default:
          throw new Error("UNKNOWN_FUNCTION");
      }

      // 🔥 Second completion (professional formatting)
      const secondResponse = await askModel([
        ...messages,
        message,
        {
          role: "function",
          name: functionName,
          content: JSON.stringify(functionResult),
        },
      ]);

      return secondResponse.choices?.[0]?.message?.content;
    }

    // 🟢 Normal conversation
    return message.content;
  } catch (error) {
    logger.error(`Chatbot processing error: ${error.message}`);

    switch (error.message) {
      case "AI_SERVICE_FAILURE":
        return "El servicio de inteligencia artificial no está disponible.";

      case "INVALID_FUNCTION_ARGUMENTS":
        return "Hubo un problema procesando la solicitud.";

      default:
        return "Ocurrió un error inesperado.";
    }
  }
};
