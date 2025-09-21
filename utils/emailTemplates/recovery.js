const { renderLayout } = require('./layout');

function renderRecoveryEmail({ actionLink, recipientName }) {
  const appName = process.env.APP_NAME || 'ScriptiFlow';
  const contentHtml = `
    <p>Hi${recipientName ? ' ' + recipientName : ''},</p>
    <p>We received a request to reset your ${appName} password. Click the button below to set a new password.</p>
    <p><a class="cta" href="${actionLink}" target="_blank" rel="noopener">Reset password</a></p>
    <p class="muted">If you did not request this, you can ignore this email.</p>
    <p class="muted">If the button doesn’t work, copy and paste this link into your browser:<br />
      <a href="${actionLink}">${actionLink}</a>
    </p>
  `;
  return renderLayout({
    title: `Reset your ${appName} password`,
    previewText: `Set a new password for your ${appName} account`,
    contentHtml,
  });
}

module.exports = { renderRecoveryEmail };


