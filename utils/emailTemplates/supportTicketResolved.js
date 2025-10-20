const { renderLayout } = require('./layout');

function renderSupportTicketResolvedEmail({ recipientName, subject, ticketId }) {
  const appName = process.env.APP_NAME || 'ScriptiFlow';
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  
  const contentHtml = `
    <p class="greeting">Hi${recipientName ? ' ' + recipientName : ''}!</p>
    <p>Great news! Your support ticket has been marked as <strong style="color: #059669;">resolved</strong>. ✅</p>
    
    <div class="info-box">
      <p><strong>📋 Ticket Details:</strong></p>
      <p><strong>Subject:</strong> ${subject}<br/>
      <strong>Ticket ID:</strong> #${ticketId}<br/>
      <strong>Status:</strong> <span style="color: #059669; font-weight: 600;">Resolved</span></p>
    </div>
    
    <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-left: 4px solid #10b981; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
      <p style="margin: 0; font-size: 18px; color: #065f46; font-weight: 600;">🎉 Issue Resolved!</p>
      <p style="margin: 12px 0 0 0; font-size: 14px; color: #047857;">We're glad we could help you. Thank you for your patience.</p>
    </div>
    
    <p style="font-size: 15px; color: #374151;"><strong>📊 Was this helpful?</strong></p>
    <p style="font-size: 14px; color: #4b5563; line-height: 1.7;">
      We'd love to hear your feedback about your support experience. Your input helps us improve our service for everyone.
    </p>
    
    <div class="cta-wrapper">
      <a class="cta" href="${baseUrl}/dashboard/support" target="_blank" rel="noopener">View Support History</a>
    </div>
    
    <div class="divider"></div>
    
    <p style="font-size: 15px; color: #374151;"><strong>🔄 Need More Help?</strong></p>
    <p style="font-size: 14px; color: #4b5563; line-height: 1.7;">
      If you're still experiencing issues or have additional questions:<br/>
      • Create a new support ticket<br/>
      • Reference this ticket ID for faster resolution<br/>
      • Visit our help center for common solutions<br/>
      • Check our FAQ section
    </p>
    
    <div class="info-box" style="background: #fffbeb; border-left-color: #f59e0b;">
      <p style="margin: 0; font-size: 14px; color: #92400e;">
        <strong>💬 Still need assistance?</strong><br/>
        Feel free to reply to this ticket or create a new one anytime. We're here to help!
      </p>
    </div>
    
    <p class="muted">Thank you for being a valued member of ${appName}. We appreciate your patience and understanding.</p>
  `;
  
  return renderLayout({
    title: `Support Ticket Resolved - ${appName}`,
    previewText: `Your support ticket "${subject}" has been resolved`,
    contentHtml,
  });
}

module.exports = { renderSupportTicketResolvedEmail };

