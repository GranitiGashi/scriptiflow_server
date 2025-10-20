function renderLayout({ title, previewText, contentHtml }) {
  const appName = process.env.APP_NAME || 'ScriptiFlow';
  const brandPrimary = '#3b82f6';
  const brandSecondary = '#8b5cf6';
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const currentYear = new Date().getFullYear();

  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="x-ua-compatible" content="ie=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      * { box-sizing: border-box; }
      body { 
        background: linear-gradient(135deg, #f5f7fa 0%, #e4e9f2 100%); 
        margin: 0; 
        padding: 0; 
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; 
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      .email-wrapper { 
        width: 100%; 
        padding: 40px 20px; 
      }
      .container { 
        max-width: 600px; 
        margin: 0 auto; 
        background: #ffffff; 
        border-radius: 16px; 
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04); 
        overflow: hidden;
      }
      .header { 
        background: linear-gradient(135deg, ${brandPrimary} 0%, ${brandSecondary} 100%); 
        color: #ffffff; 
        padding: 40px 32px; 
        text-align: center;
        position: relative;
      }
      .header::after {
        content: '';
        position: absolute;
        bottom: -2px;
        left: 0;
        right: 0;
        height: 4px;
        background: linear-gradient(90deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.1) 100%);
      }
      .header h1 { 
        margin: 0; 
        font-size: 28px; 
        font-weight: 700;
        letter-spacing: -0.5px;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }
      .body { 
        padding: 40px 32px; 
        color: #1f2937; 
        line-height: 1.7;
      }
      .body p { 
        margin: 0 0 16px 0; 
        font-size: 16px;
      }
      .body p:last-child {
        margin-bottom: 0;
      }
      .greeting {
        font-size: 18px;
        font-weight: 600;
        color: #111827;
        margin-bottom: 20px !important;
      }
      .cta-wrapper {
        text-align: center;
        margin: 32px 0;
      }
      .cta { 
        display: inline-block; 
        background: linear-gradient(135deg, ${brandPrimary} 0%, #2563eb 100%); 
        color: #ffffff !important; 
        text-decoration: none; 
        padding: 16px 40px; 
        border-radius: 10px; 
        font-weight: 600;
        font-size: 16px;
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
        transition: all 0.3s ease;
      }
      .cta:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4);
      }
      .divider {
        height: 1px;
        background: linear-gradient(90deg, transparent 0%, #e5e7eb 50%, transparent 100%);
        margin: 32px 0;
      }
      .info-box {
        background: #f9fafb;
        border-left: 4px solid ${brandPrimary};
        padding: 16px 20px;
        border-radius: 8px;
        margin: 24px 0;
      }
      .info-box p {
        margin: 0;
        font-size: 14px;
        color: #4b5563;
      }
      .muted { 
        color: #6b7280; 
        font-size: 13px; 
        line-height: 1.6;
      }
      .footer { 
        background: #f9fafb;
        padding: 32px; 
        color: #6b7280; 
        font-size: 13px; 
        text-align: center;
        border-top: 1px solid #e5e7eb;
      }
      .footer-links {
        margin: 16px 0;
      }
      .footer-links a {
        color: #6b7280;
        text-decoration: none;
        margin: 0 12px;
        font-weight: 500;
      }
      .footer-links a:hover {
        color: ${brandPrimary};
      }
      .footer-brand {
        font-weight: 600;
        color: #374151;
        margin-bottom: 12px;
      }
      .footer-note {
        margin-top: 16px;
        color: #9ca3af;
        font-size: 12px;
      }
      a { 
        color: ${brandPrimary}; 
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      @media only screen and (max-width: 600px) {
        .email-wrapper {
          padding: 20px 10px;
        }
        .header {
          padding: 32px 24px;
        }
        .header h1 {
          font-size: 24px;
        }
        .body {
          padding: 32px 24px;
        }
        .footer {
          padding: 24px;
        }
        .cta {
          padding: 14px 32px;
          font-size: 15px;
        }
      }
    </style>
  </head>
  <body>
    <div style="display:none;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${previewText || ''}</div>
    <div class="email-wrapper">
      <div class="container">
        <div class="header">
          <h1>${appName}</h1>
        </div>
        <div class="body">
          ${contentHtml}
        </div>
        <div class="footer">
          <div class="footer-brand">${appName}</div>
          <div class="footer-links">
            <a href="${baseUrl}">Home</a>
            <a href="${baseUrl}/support">Support</a>
            <a href="${baseUrl}/privacy">Privacy</a>
          </div>
          <div class="footer-note">
            © ${currentYear} ${appName}. All rights reserved.<br/>
            If you weren't expecting this email, you can safely ignore it.
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

module.exports = { renderLayout };


