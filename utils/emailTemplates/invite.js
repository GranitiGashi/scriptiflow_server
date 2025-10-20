const { renderLayout } = require('./layout');

function renderInviteEmail({ actionLink, recipientName }) {
  const appName = process.env.APP_NAME || 'ScriptiFlow';
  const contentHtml = `
    <p class="greeting">👋 Welcome${recipientName ? ' ' + recipientName : ''}!</p>
    <p>You've been invited to join <strong>${appName}</strong>. We're excited to have you on board!</p>
    <p>To get started, you'll need to set up your password and complete your account setup. This will give you access to all the amazing features we have to offer.</p>
    
    <div class="cta-wrapper">
      <a class="cta" href="${actionLink}" target="_blank" rel="noopener">Set Your Password</a>
    </div>
    
    <div class="info-box">
      <p><strong>🔐 Security tip:</strong> Choose a strong password with at least 8 characters, including uppercase, lowercase, numbers, and symbols.</p>
    </div>
    
    <div class="divider"></div>
    
    <p class="muted"><strong>Having trouble with the button?</strong><br/>
      Copy and paste this link into your browser:<br />
      <a href="${actionLink}">${actionLink}</a>
    </p>
    
    <p class="muted">This invitation link will expire in 24 hours for security reasons.</p>
  `;
  return renderLayout({
    title: `You're Invited to ${appName}! 🎉`,
    previewText: `Welcome aboard! Set your password to get started with ${appName}`,
    contentHtml,
  });
}

module.exports = { renderInviteEmail };


