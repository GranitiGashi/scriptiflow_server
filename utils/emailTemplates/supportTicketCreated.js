const { renderLayout } = require('./layout');

function renderSupportTicketCreatedEmail({ recipientName, subject, message, ticketId }) {
  const appName = process.env.APP_NAME || 'ScriptiFlow';
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  
  const contentHtml = `
    <p class="greeting">Hi${recipientName ? ' ' + recipientName : ''}!</p>
    <p>Thank you for reaching out to us. We've successfully received your support ticket and our team will review it shortly.</p>
    
    <div class="info-box">
      <p><strong>📋 Ticket Details:</strong></p>
      <p><strong>Subject:</strong> ${subject}<br/>
      <strong>Ticket ID:</strong> #${ticketId}</p>
    </div>
    
    <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin: 24px 0;">
      <p style="margin: 0; font-size: 14px; color: #6b7280;"><strong>Your Message:</strong></p>
      <p style="margin: 12px 0 0 0; font-size: 15px; color: #374151; line-height: 1.6;">${message.replace(/\n/g, '<br/>')}</p>
    </div>
    
    <div class="cta-wrapper">
      <a class="cta" href="${baseUrl}/dashboard/support" target="_blank" rel="noopener">View Your Tickets</a>
    </div>
    
    <div class="divider"></div>
    
    <p style="font-size: 15px; color: #374151;"><strong>⏱️ What happens next?</strong></p>
    <p style="font-size: 14px; color: #4b5563; line-height: 1.7;">
      • Our support team will review your ticket<br/>
      • You'll receive an email when we respond<br/>
      • You can track progress in your support dashboard<br/>
      • Typical response time: 24-48 hours
    </p>
    
    <p class="muted"><strong>Need urgent help?</strong> For critical issues, please mark your ticket as high priority or contact us directly.</p>
  `;
  
  return renderLayout({
    title: `Support Ticket Received - ${appName}`,
    previewText: `We've received your support ticket and will respond soon`,
    contentHtml,
  });
}

module.exports = { renderSupportTicketCreatedEmail };

