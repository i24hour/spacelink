import { createTransport } from "nodemailer";

const transporter = createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
  },
});

export function buildEmailTemplate(subject: string, bodyText: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
  <style>
    @media only screen and (max-width: 600px) {
      .container { width: 100% !important; padding: 24px !important; }
      .heading { font-size: 20px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #050505; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" class="container" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width: 560px; width: 100%; background: #0a0a0f; border-radius: 16px; border: 1px solid rgba(255,255,255,0.06); overflow: hidden;">
          <tr>
            <td style="padding: 32px 32px 16px;">
              <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 24px;">
                <div style="width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, #6366f1, #8b5cf6); display: inline-block;"></div>
                <span style="font-size: 18px; font-weight: 700; color: #f1f5f9; letter-spacing: -0.5px;">DeadlineAI</span>
              </div>
              <h1 class="heading" style="font-size: 22px; font-weight: 700; color: #f8fafc; margin: 0 0 12px; line-height: 1.3;">${subject}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 32px 24px;">
              <div style="font-size: 15px; line-height: 1.7; color: #cbd5e1;">
                ${bodyText.replace(/\n/g, "<br/>")}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 32px 32px;">
              <div style="border-top: 1px solid rgba(255,255,255,0.06); padding-top: 20px; font-size: 12px; color: #64748b; line-height: 1.5;">
                You are receiving this because you saved an opportunity on DeadlineAI.<br />
                <a href="${process.env.FRONTEND_URL || "http://localhost:3000"}/settings" style="color: #8b5cf6; text-decoration: none;">Manage notifications</a>
              </div>
            </td>
          </tr>
        </table>
        <p style="font-size: 12px; color: #475569; margin-top: 24px;">
          DeadlineAI · Never miss an opportunity
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendEmail(to: string, subject: string, bodyText: string) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("SMTP credentials missing");
    return { delivered: false, error: "No SMTP credentials" };
  }
  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || "DeadlineAI <reminders@deadlineai.dev>",
      to,
      subject,
      html: buildEmailTemplate(subject, bodyText),
      text: bodyText,
    });
    return { delivered: true, data: { messageId: info.messageId } };
  } catch (err: any) {
    return { delivered: false, error: err?.message || String(err) };
  }
}
