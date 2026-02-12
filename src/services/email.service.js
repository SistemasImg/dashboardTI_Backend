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

    console.log("Alert email sent successfully.");
  } catch (error) {
    console.error("Error sending alert email:", error.message);
  }
};

module.exports = {
  sendServiceAlertEmail,
};
