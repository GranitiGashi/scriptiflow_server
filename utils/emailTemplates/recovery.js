const { renderLayout } = require('./layout');

function renderRecoveryEmail({ actionLink, recipientName }) {
  const appName = process.env.APP_NAME || 'ScriptiFlow';
  const contentHtml = `
    <p class="greeting">Hi${recipientName ? ' ' + recipientName : ''}!</p>
    <p>We received a request to reset the password for your <strong>${appName}</strong> account.</p>
    <p>If you made this request, click the button below to create a new password. If you didn't request this, you can safely ignore this email.</p>
    
    <div class="cta-wrapper">
      <a class="cta" href="${actionLink}" target="_blank" rel="noopener">Reset Your Password</a>
    </div>
    
    <div class="info-box">
      <p><strong>🔒 Security Notice:</strong></p>
      <p>• This password reset link will expire in 1 hour<br/>
      • Your current password remains active until you set a new one<br/>
      • We'll never ask for your password via email</p>
    </div>
    
    <div class="divider"></div>
    
    <p class="muted"><strong>Button not working?</strong><br/>
      Copy and paste this link into your browser:<br />
      <a href="${actionLink}">${actionLink}</a>
    </p>
    
    <p class="muted"><strong>❗ Didn't request this?</strong><br/>
    If you didn't request a password reset, please ignore this email or <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/support">contact our support team</a> if you're concerned about your account security.</p>
  `;
  return renderLayout({
    title: `Reset Your ${appName} Password 🔑`,
    previewText: `Reset your password to regain access to your ${appName} account`,
    contentHtml,
  });
}

module.exports = { renderRecoveryEmail };


