const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.office365.com",
  port: 587,
  secure: false,
  auth: {
    user: "automation@img360.com",
    pass: "$P@ut0adm1n#",
  },
  tls: {
    rejectUnauthorized: false,
  },
});

const sendServiceAlertEmail = async ({ salesforce, sqlserver }) => {
  try {
    let failedServices = [];
    if (salesforce !== "connected") failedServices.push("Salesforce");
    if (sqlserver !== "connected") failedServices.push("SQL Server");

    if (failedServices.length === 0) return;

    const serviceList = failedServices.join(" & ");

    await transporter.sendMail({
      from: '"IMG360 Automation" <automation@img360.com>',
      to: ["alexander.oyolo@img360.com", "bruno.flores@img360.com"],
      subject: `🚨 Service Down Alert - ${serviceList}`,
      html: `
        <h2>Service Interruption Detected</h2>
        <p>The following service(s) are currently not responding:</p>
        <ul>
          ${failedServices.map((s) => `<li><strong>${s}</strong></li>`).join("")}
        </ul>
        <p>Please review the system immediately.</p>
        <hr/>
        <small>IMG360 Monitoring System</small>
      `,
    });
  } catch (error) {
    console.error("Error sending alert email:", error.message);
  }
};

const sendVicidialExceededTimeEmail = async ({ alerts, generatedAt }) => {
  try {
    if (!Array.isArray(alerts) || alerts.length === 0) return;

    const rowsHtml = alerts
      .map(
        (item) => `
          <tr>
            <td style="padding:8px;border:1px solid #ddd;">${item.user || "-"}</td>
            <td style="padding:8px;border:1px solid #ddd;">${item.name || "-"}</td>
            <td style="padding:8px;border:1px solid #ddd;">${item.campaign || "-"}</td>
            <td style="padding:8px;border:1px solid #ddd;">${item.status || "-"}</td>
            <td style="padding:8px;border:1px solid #ddd;">${item.pause_code || "-"}</td>
            <td style="padding:8px;border:1px solid #ddd;">${item.rule_label || "-"}</td>
            <td style="padding:8px;border:1px solid #ddd;">${item.time_in_status || "-"}</td>
            <td style="padding:8px;border:1px solid #ddd;">${item.max_allowed || "-"}</td>
            <td style="padding:8px;border:1px solid #ddd;">${item.exceeded_by || "-"}</td>
          </tr>
        `,
      )
      .join("");

    await transporter.sendMail({
      from: '"IMG360 Automation" <automation@img360.com>',
      to: ["katherine.hidalgo@img360.com", "jocelyn.sairitupac@img360.com"],
      cc: ["christyjen.ruiz@img360.com"],
      subject: `Alerta Vicidial: ${alerts.length} agente(s) excedieron tiempo permitido`,
      html: `
        <h2>Alerta de Exceso de Tiempo en Vicidial</h2>
        <p>Se detectaron agentes que exceden los tiempos permitidos por regla.</p>
        <p><strong>Generado:</strong> ${generatedAt || new Date().toISOString()}</p>
        <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px;">
          <thead>
            <tr style="background:#f5f5f5;">
              <th style="padding:8px;border:1px solid #ddd;">Usuario</th>
              <th style="padding:8px;border:1px solid #ddd;">Nombre</th>
              <th style="padding:8px;border:1px solid #ddd;">Campaña</th>
              <th style="padding:8px;border:1px solid #ddd;">Status</th>
              <th style="padding:8px;border:1px solid #ddd;">Pause Code</th>
              <th style="padding:8px;border:1px solid #ddd;">Regla</th>
              <th style="padding:8px;border:1px solid #ddd;">Tiempo actual</th>
              <th style="padding:8px;border:1px solid #ddd;">Máximo permitido</th>
              <th style="padding:8px;border:1px solid #ddd;">Exceso</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
        <hr/>
        <small>IMG360 Monitoring System</small>
      `,
    });
  } catch (error) {
    console.error("Error sending Vicidial exceeded-time email:", error.message);
  }
};

module.exports = {
  sendServiceAlertEmail,
  sendVicidialExceededTimeEmail,
};
