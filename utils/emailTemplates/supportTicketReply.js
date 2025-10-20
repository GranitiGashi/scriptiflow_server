const { renderLayout } = require('./layout');

function renderSupportTicketReplyEmail({ recipientName, subject, message, ticketId }) {
  const appName = process.env.APP_NAME || 'ScriptiFlow';
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  
  const contentHtml = `
    <p class="greeting">Hi${recipientName ? ' ' + recipientName : ''}! 👋</p>
    <p>Good news! Our support team has responded to your ticket.</p>
    
    <div class="info-box">
      <p><strong>📧 Ticket:</strong> ${subject}</p>
      <p><strong>Ticket ID:</strong> #${ticketId}</p>
    </div>
    
    <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border-left: 4px solid #3b82f6; border-radius: 8px; padding: 20px; margin: 24px 0; box-shadow: 0 2px 8px rgba(59, 130, 246, 0.1);">
      <p style="margin: 0; font-size: 14px; color: #1e40af; font-weight: 600;">💬 Support Team Reply:</p>
      <p style="margin: 12px 0 0 0; font-size: 15px; color: #1e3a8a; line-height: 1.7;">${message.replace(/\n/g, '<br/>')}</p>
    </div>
    
    <div class="cta-wrapper">
      <a class="cta" href="${baseUrl}/dashboard/support" target="_blank" rel="noopener">View & Reply</a>
    </div>
    
    <div class="divider"></div>
    
    <p style="font-size: 15px; color: #374151;"><strong>💡 Quick Actions:</strong></p>
    <p style="font-size: 14px; color: #4b5563; line-height: 1.7;">
      • Reply to continue the conversation<br/>
      • Upload screenshots or files if needed<br/>
      • Mark as resolved if your issue is fixed<br/>
      • View all your tickets in the support dashboard
    </p>
    
    <p class="muted">You're receiving this email because you created a support ticket with ${appName}. All replies will be sent to this email address.</p>
  `;
  
  return renderLayout({
    title: `New Reply to Your Support Ticket - ${appName}`,
    previewText: `Our support team has responded to your ticket: ${subject}`,
    contentHtml,
  });
}

module.exports = { renderSupportTicketReplyEmail };

