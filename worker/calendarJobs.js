const supabase = require('../config/supabaseClient');
const supabaseAdmin = require('../config/supabaseAdmin');
const { sendEmail } = require('../utils/email');

async function sendUpcomingReminders()() {}

async function sendUpcomingReminders() {
  const now = Date.now();
  const in10 = new Date(now + 10 * 60 * 1000).toISOString();
  const in11 = new Date(now + 11 * 60 * 1000).toISOString();
  const { data: events } = await supabase
    .from('calendar_events')
    .select('id, user_id, title, start_time, car_mobile_de_id, contact_id')
    .is('deleted_at', null)
    .gte('start_time', in10)
    .lt('start_time', in11);
  if (!events || !events.length) return { sent: 0 };

  let sent = 0;
  for (const ev of events) {
    let contact = null;
    if (ev.contact_id) {
      const { data } = await supabase.from('crm_contacts').select('first_name,last_name,email').eq('id', ev.contact_id).maybeSingle();
      contact = data || null;
    }
    const to = contact?.email || null;
    if (!to) continue;
    const subject = `Reminder: ${ev.title} in 10 minutes`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937">
        <h2 style="margin:0 0 8px">Upcoming Test Drive</h2>
        <p style="margin:0 0 12px">Hi ${contact?.first_name || ''},</p>
        <p style="margin:0 0 12px">This is a reminder that your event <strong>${ev.title}</strong> starts in 10 minutes.</p>
        ${ev.car_mobile_de_id ? `<p style="margin:0 0 12px">Car ID: <strong>${ev.car_mobile_de_id}</strong></p>` : ''}
        <p style="margin:0 0 12px;color:#6b7280">If you need to reschedule, please contact the dealership.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0"/>
        <p style="font-size:12px;color:#9ca3af">This is an automated message from Scriptiflow. Please do not reply.</p>
      </div>
    `;
    try { await sendEmail({ to, subject, html }); sent += 1; } catch (_) {}
  }
  return { sent };
}

module.exports = { sendUpcomingReminders };


