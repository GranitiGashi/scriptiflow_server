const { renderLayout } = require('./layout');

function renderSupportAdminNotificationEmail({ userEmail, userName, subject, message, ticketId }) {
  const appName = process.env.APP_NAME || 'ScriptiFlow';
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  
  const contentHtml = `
    <p class="greeting">🔔 New Support Ticket Alert</p>
    <p>A new support ticket has been created and requires your attention.</p>
    
    <div class="info-box">
      <p><strong>👤 User Information:</strong></p>
      <p><strong>Name:</strong> ${userName || 'Not provided'}<br/>
      <strong>Email:</strong> ${userEmail}<br/>
      <strong>Ticket ID:</strong> #${ticketId}</p>
    </div>
    
    <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin: 24px 0; border: 1px solid #e5e7eb;">
      <p style="margin: 0; font-size: 14px; color: #6b7280; font-weight: 600;">📋 Subject:</p>
      <p style="margin: 8px 0 16px 0; font-size: 16px; color: #111827; font-weight: 600;">${subject}</p>
      
      <p style="margin: 0; font-size: 14px; color: #6b7280; font-weight: 600;">💬 Message:</p>
      <p style="margin: 8px 0 0 0; font-size: 15px; color: #374151; line-height: 1.7; white-space: pre-wrap;">${message.replace(/\n/g, '<br/>')}</p>
    </div>
    
    <div class="cta-wrapper">
      <a class="cta" href="${baseUrl}/dashboard/admin/support" target="_blank" rel="noopener">View Ticket & Respond</a>
    </div>
    
    <div class="divider"></div>
    
    <p style="font-size: 14px; color: #6b7280; line-height: 1.6;">
      <strong>⏰ Created:</strong> ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}<br/>
      <strong>🎯 Priority:</strong> Normal<br/>
      <strong>📊 Status:</strong> Open
    </p>
    
    <p class="muted">This is an automated notification sent to the support team. Please respond to the ticket through the admin dashboard.</p>
  `;
  
  return renderLayout({
    title: `New Support Ticket - ${appName} Admin`,
    previewText: `New ticket from ${userEmail}: ${subject}`,
    contentHtml,
  });
}

module.exports = { renderSupportAdminNotificationEmail };

