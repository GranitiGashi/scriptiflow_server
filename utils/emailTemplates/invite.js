const { renderLayout } = require('./layout');

function renderInviteEmail({ actionLink, recipientName }) {
  const appName = process.env.APP_NAME || 'ScriptiFlow';
  const contentHtml = `
    <p>Hi${recipientName ? ' ' + recipientName : ''},</p>
    <p>You've been invited to ${appName}. Click the button below to set your password and complete your account setup.</p>
    <p><a class="cta" href="${actionLink}" target="_blank" rel="noopener">Set your password</a></p>
    <p class="muted">If the button doesn’t work, copy and paste this link into your browser:<br />
      <a href="${actionLink}">${actionLink}</a>
    </p>
  `;
  return renderLayout({
    title: `You're invited to ${appName}`,
    previewText: `Set your password to get started with ${appName}`,
    contentHtml,
  });
}

module.exports = { renderInviteEmail };


