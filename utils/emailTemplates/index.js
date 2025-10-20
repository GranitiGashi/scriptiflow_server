// Email Templates Index
// Centralized export for all email templates

const { renderLayout } = require('./layout');
const { renderInviteEmail } = require('./invite');
const { renderRecoveryEmail } = require('./recovery');
const { renderSupportTicketCreatedEmail } = require('./supportTicketCreated');
const { renderSupportTicketReplyEmail } = require('./supportTicketReply');
const { renderSupportTicketResolvedEmail } = require('./supportTicketResolved');
const { renderSupportAdminNotificationEmail } = require('./supportAdminNotification');

module.exports = {
  // Core layout
  renderLayout,
  
  // Authentication emails
  renderInviteEmail,
  renderRecoveryEmail,
  
  // Support system emails
  renderSupportTicketCreatedEmail,
  renderSupportTicketReplyEmail,
  renderSupportTicketResolvedEmail,
  renderSupportAdminNotificationEmail,
};

