let nodemailer = null;
try {
  // Attempt to load nodemailer; if not installed, fall back to no-op mailer
  // This prevents MODULE_NOT_FOUND during deploy when SMTP isn't configured yet
  nodemailer = require('nodemailer');
} catch (_) {
  nodemailer = null;
}

function getTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!nodemailer || !SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    return null;
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

async function sendEmail({ to, subject, text, html }) {
  const from = process.env.FROM_EMAIL || 'no-reply@scriptiflow.app';
  const transporter = getTransport();
  if (!transporter) {
    console.log('[email] SMTP not configured. Would send:', { to, subject, text });
    return { mocked: true };
  }
  const info = await transporter.sendMail({ from, to, subject, text, html });
  return info;
}

module.exports = { sendEmail };


