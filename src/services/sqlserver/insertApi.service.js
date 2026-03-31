const { getPool } = require("./pool.service");
const logger = require("../../utils/logger");

// Insert agent time data into SQL Server
async function insertVicidialAgentTime(data) {
  logger.info("VicidialService → insertVicidialAgentTime() started");

  try {
    const pool = await getPool();

    const query = `
      INSERT INTO INTAKE.vicidial_agent_time (
        date, user_id, user_name, total_login,
        pause_sec, wait_sec, talk_sec, dispo_sec,
        dead_sec, customer_sec, pause_ANDIAL,
        pause_DCMX, pause_DISMX, pause_GRABCL,
        pause_LAGGED, pause_LOGIN, pause_LOGOUT,
        pause_MDSKIP, pause_NXDIAL, pause_PAUSMX,
        pause_PRECAL, pause_RQUEUE, pause_NULL,
        pause_BackOf, pause_BathBr, pause_Break,
        pause_Coach, pause_CoMeet, pause_ITAsis,
        pause_ManDia, pause_Meal, pause_TeamMe
      )
      VALUES (
        @date, @user_id, @user_name, @total_login,
        @pause_sec, @wait_sec, @talk_sec, @dispo_sec,
        @dead_sec, @customer_sec, @pause_ANDIAL,
        @pause_DCMX, @pause_DISMX, @pause_GRABCL,
        @pause_LAGGED, @pause_LOGIN, @pause_LOGOUT,
        @pause_MDSKIP, @pause_NXDIAL, @pause_PAUSMX,
        @pause_PRECAL, @pause_RQUEUE, @pause_NULL,
        @pause_BackOf, @pause_BathBr, @pause_Break,
        @pause_Coach, @pause_CoMeet, @pause_ITAsis,
        @pause_ManDia, @pause_Meal, @pause_TeamMe
      )
    `;

    const request = pool.request();

    // Strings (varchar)
    request.input("date", data.date);
    request.input("user_id", data.user_id);
    request.input("user_name", data.user_name);

    // Integers
    request.input("total_login", data.total_login);
    request.input("pause_sec", data.pause_sec);
    request.input("wait_sec", data.wait_sec);
    request.input("talk_sec", data.talk_sec);
    request.input("dispo_sec", data.dispo_sec);
    request.input("dead_sec", data.dead_sec);
    request.input("customer_sec", data.customer_sec);
    request.input("pause_ANDIAL", data.pause_ANDIAL);
    request.input("pause_DCMX", data.pause_DCMX);
    request.input("pause_DISMX", data.pause_DISMX);
    request.input("pause_GRABCL", data.pause_GRABCL);
    request.input("pause_LAGGED", data.pause_LAGGED);
    request.input("pause_LOGIN", data.pause_LOGIN);
    request.input("pause_LOGOUT", data.pause_LOGOUT);
    request.input("pause_MDSKIP", data.pause_MDSKIP);
    request.input("pause_NXDIAL", data.pause_NXDIAL);
    request.input("pause_PAUSMX", data.pause_PAUSMX);
    request.input("pause_PRECAL", data.pause_PRECAL);
    request.input("pause_RQUEUE", data.pause_RQUEUE);
    request.input("pause_NULL", data.pause_NULL);
    request.input("pause_BackOf", data.pause_BackOf);
    request.input("pause_BathBr", data.pause_BathBr);
    request.input("pause_Break", data.pause_Break);
    request.input("pause_Coach", data.pause_Coach);
    request.input("pause_CoMeet", data.pause_CoMeet);
    request.input("pause_ITAsis", data.pause_ITAsis);
    request.input("pause_ManDia", data.pause_ManDia);
    request.input("pause_Meal", data.pause_Meal);
    request.input("pause_TeamMe", data.pause_TeamMe);

    await request.query(query);

    logger.success("VicidialService → Insert successful");

    return { message: "Data inserted successfully" };
  } catch (error) {
    logger.error("VicidialService → error", error.message);
    throw error;
  }
}

module.exports = {
  insertVicidialAgentTime,
};
