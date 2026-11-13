/*
 * Branded HTML email, no dependencies. Table layout and inline styles only,
 * because that is what Gmail, Outlook and Apple Mail all render the same.
 * Every function returns { subject, html, text }: always send both parts, the
 * text one is what spam filters and plain-text clients read.
 *
 *   const brand = { appName: 'NextGen', color: '#1a56db', logoUrl: 'https://…/logo.png', url: 'https://…' };
 *   await mailer.send({ to, ...loginCodeEmail({ brand, code }) });
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#1a56db');
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);

/**
 * The one layout every email uses.
 *   brand:      { appName, color, logoUrl, url, address }
 *   title:      big heading
 *   preheader:  inbox preview line (hidden in the body)
 *   paragraphs: array of strings (escaped; blank lines are not needed)
 *   code:       a one-time code shown large and spaced
 *   button:     { label, url }
 *   rows:       [[label, value], …] a key/value table (notifications, receipts)
 *   footnote:   small grey text under everything (why they got it)
 */
export function renderEmail({ brand = {}, subject, title, preheader, paragraphs = [], code, button, rows, footnote }) {
  const color = safeColor(brand.color);
  const app = brand.appName || 'Notification';
  const btnUrl = safeUrl(button?.url);
  const logo = safeUrl(brand.logoUrl);
  const home = safeUrl(brand.url);

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${esc(subject || title)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="padding:0 4px 16px;font-family:${FONT};font-size:18px;font-weight:700;color:#111827;">
      ${logo ? `<img src="${esc(logo)}" alt="${esc(app)}" height="32" style="display:block;height:32px;border:0;">` : esc(app)}
    </td></tr>
    <tr><td style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px 28px;font-family:${FONT};color:#1f2937;">
      ${title ? `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:700;color:#111827;">${esc(title)}</h1>` : ''}
      ${paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;">${esc(p)}</p>`).join('\n      ')}
      ${code ? `<div style="margin:8px 0 24px;padding:16px;background:#f3f4f6;border-radius:8px;text-align:center;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#111827;">${esc(code)}</div>` : ''}
      ${rows?.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-top:1px solid #e5e7eb;">${rows.map(([k, v]) => `<tr><td style="padding:10px 12px 10px 0;border-bottom:1px solid #e5e7eb;font-size:14px;color:#6b7280;vertical-align:top;white-space:nowrap;width:1%;">${esc(k)}</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">${esc(v)}</td></tr>`).join('')}</table>` : ''}
      ${btnUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 8px;"><tr><td style="border-radius:8px;background:${color};"><a href="${esc(btnUrl)}" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(button.label)}</a></td></tr></table>
      <p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:#6b7280;">Button not working? Paste this link into your browser:<br><a href="${esc(btnUrl)}" style="color:${color};word-break:break-all;">${esc(btnUrl)}</a></p>` : ''}
    </td></tr>
    <tr><td style="padding:16px 4px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:#6b7280;">
      ${footnote ? `${esc(footnote)}<br>` : ''}${home ? `<a href="${esc(home)}" style="color:#6b7280;">${esc(app)}</a>` : esc(app)}${brand.address ? ` · ${esc(brand.address)}` : ''}
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const text = [
    title,
    ...paragraphs,
    code && `Code: ${code}`,
    ...(rows || []).map(([k, v]) => `${k}: ${v}`),
    btnUrl && `${button.label}: ${btnUrl}`,
    footnote,
    `— ${app}${home ? ` (${home})` : ''}`,
  ].filter(Boolean).join('\n\n');

  return { subject: subject || title, html, text };
}

/** Sign-in code. */
export function loginCodeEmail({ brand = {}, code, minutes = 10 }) {
  const app = brand.appName || 'your account';
  return renderEmail({
    brand,
    subject: `${code} is your ${brand.appName ? `${brand.appName} ` : ''}sign-in code`,
    preheader: `Your code expires in ${minutes} minutes.`,
    title: 'Your sign-in code',
    paragraphs: [`Enter this code to sign in to ${app}. It expires in ${minutes} minutes and works once.`],
    code,
    footnote: "If you didn't try to sign in, you can ignore this email. Nobody can get in without the code.",
  });
}

/** Sent after a password is set or changed. */
export function passwordChangedEmail({ brand = {}, when = new Date() }) {
  return renderEmail({
    brand,
    subject: 'Your password was changed',
    title: 'Your password was changed',
    paragraphs: [
      `The password for your ${brand.appName || ''} account was changed on ${when.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.`,
      'Every other device has been signed out.',
    ],
    footnote: "If this wasn't you, sign in with an email code right away and set a new password.",
  });
}

/** Invite someone to an account. */
export function inviteEmail({ brand = {}, inviter, url }) {
  return renderEmail({
    brand,
    subject: `You're invited to ${brand.appName || 'an account'}`,
    title: `Join ${brand.appName || 'the team'}`,
    paragraphs: [`${inviter ? `${inviter} added you` : 'You were added'} to ${brand.appName || 'an account'}. Sign in with this email address to get started.`],
    button: { label: 'Sign in', url },
  });
}

/**
 * Staff alert: new lead, new booking, a form submission.
 *   notificationEmail({ brand, title: 'New lead', rows: [['Name', 'Ana'], ['Phone', '…']], button: { label: 'Open', url } })
 */
export function notificationEmail({ brand = {}, title, intro, rows, button, footnote }) {
  return renderEmail({
    brand,
    subject: title,
    preheader: intro,
    title,
    paragraphs: intro ? [intro] : [],
    rows,
    button,
    footnote: footnote ?? "You're getting this because notifications are on for your account.",
  });
}
