// Resolve datacenter prefix from explicit env or API key suffix (e.g. us21).
function resolveServerPrefix(apiKey, explicitPrefix) {
  if (explicitPrefix) return explicitPrefix;
  if (!apiKey?.includes("-")) return "";
  return apiKey.split("-").pop();
}

const apiKey = process.env.MAILCHIMP_API_KEY || "";

const sharedInlineHtml = `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 24px 0;"><tr><td align="center"><img src="https://campaigns.legalhelpadvisor.com/wp-content/uploads/2025/02/result_LHAcolor-5.png" alt="Legal Help Advisor" width="220" style="display:block; width:220px; max-width:220px; height:auto; border:0; outline:none; text-decoration:none;"></td></tr></table>
<p style="margin-left:0;"><span>Hi *|FNAME|*, there's only one step left to move forward with your claim!</span></p>
<p style="text-align:left;"><span>We'll be reaching out shortly, but if you're ready, you can call us now at 757-690-0256 to finish your process.</span></p>
<p style="text-align:left;"><span>We are here to help you!</span></p>
<p style="margin-left:0;"><span>If you'd like to speak now, you can click below to get in touch with us directly:</span></p>
<p style="margin-left:0;"><span>&#128073; </span><a href="tel:17576900256" tabindex="-1"><span>CALL NOW</span></a></p>
<p style="margin-left:0;"><span>You can also click below to book the <strong>best time to reach you</strong>.</span></p>
<p style="margin-left:0;"><span>&#128073; </span><a href="http://legalhelpadvisor.com/callme" target="_blank" tabindex="-1"><span>BOOK A CALL</span></a></p>
<p style="margin-left:0;"><br><span>We're here to help.</span></p>
<p><span>Best,</span></p>
<p><strong><span>Frank Smith</span></strong></p>
<p><strong><span>Legal Help Advisor</span></strong></p>`;

module.exports = {
  apiKey,
  serverPrefix: resolveServerPrefix(
    apiKey,
    process.env.MAILCHIMP_SERVER_PREFIX,
  ),
  audienceId: process.env.MAILCHIMP_AUDIENCE_ID || "",
  firstNameMergeTag: "FNAME",
  lastNameMergeTag: "LNAME",
  useFullNameInFirstNameTag: true,

  fromName: "Legal Help Advisor",
  fromEmail: "frank.smith@legalhelpadvisor.com",
  subject: "We Have Info About Your Case",
  previewText:
    "We understand what you're going through. Legal support is available to help.",
  pendingInlineHtml: sharedInlineHtml,
  unresponsiveInlineHtml: sharedInlineHtml,
  pendingInlinePlainText:
    "Hi *|FNAME|*, there's only one step left to move forward with your claim!",
  unresponsiveInlinePlainText:
    "Hi *|FNAME|*, there's only one step left to move forward with your claim!",
};
