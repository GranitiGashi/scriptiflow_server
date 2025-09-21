function renderLayout({ title, previewText, contentHtml }) {
  const appName = process.env.APP_NAME || 'ScriptiFlow';
  const brandPrimary = '#3b82f6';
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="x-ua-compatible" content="ie=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { background-color: #f6f7f9; margin: 0; padding: 0; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,'Apple Color Emoji','Segoe UI Emoji'; }
      .container { max-width: 560px; margin: 24px auto; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); overflow: hidden; }
      .header { background: linear-gradient(90deg, ${brandPrimary}, #2563eb); color: #ffffff; padding: 20px 24px; }
      .header h1 { margin: 0; font-size: 18px; }
      .body { padding: 24px; color: #111827; }
      .cta { display: inline-block; background: ${brandPrimary}; color: #ffffff !important; text-decoration: none; padding: 10px 16px; border-radius: 8px; font-weight: 600; }
      .muted { color: #6b7280; font-size: 12px; }
      .footer { padding: 16px 24px; color: #6b7280; font-size: 12px; }
      a { color: ${brandPrimary}; }
    </style>
  </head>
  <body>
    <div style="display:none;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${previewText || ''}</div>
    <div class="container">
      <div class="header">
        <h1>${appName}</h1>
      </div>
      <div class="body">
        ${contentHtml}
      </div>
      <div class="footer">
        <div>${appName} • <a href="${baseUrl}">${baseUrl.replace('https://','').replace('http://','')}</a></div>
        <div class="muted">If you weren’t expecting this email, you can safely ignore it.</div>
      </div>
    </div>
  </body>
</html>`;
}

module.exports = { renderLayout };


