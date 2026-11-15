import nodemailer from 'nodemailer';

/*
 * SMTP sending.
 *
 *   const mailer = createMailer({ host, port, user, pass, from });     // static config
 *   const mailer = createMailer({ getConfig: async () => ({ … }) });   // read per send, e.g. from a settings table
 *
 *   await mailer.send({ to, subject, html, text });   throws on failure: use where the user must see the error
 *   mailer.sendQuietly({ to, … });                    never throws, never awaited: alerts, receipts
 *   await mailer.verify();                            checks the SMTP login (for a "Send test email" button)
 *
 * No host configured: outside production it prints the email to the console
 * (so sign-in codes work locally with no SMTP); in production it throws on
 * send and sendQuietly logs a warning.
 */
export function createMailer({ getConfig, transport, logger = console, ...staticConfig } = {}) {
  const config = async () => ({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM,
    ...staticConfig,
    ...(getConfig ? await getConfig() : {}),
  });

  const transportFor = (cfg) => transport || nodemailer.createTransport({
    host: cfg.host,
    port: Number(cfg.port) || 587,
    secure: Number(cfg.port) === 465,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  });

  const isProd = () => process.env.NODE_ENV === 'production';

  async function send({ to, subject, html, text, replyTo, cc, bcc, attachments }) {
    if (!to) throw new Error('mailer.send: `to` is required');
    const cfg = await config();
    if (!cfg.host && !transport) {
      if (isProd()) throw new Error('Email is not set up: no SMTP host.');
      logger.info?.(`\n[blocks mailer: no SMTP_HOST, printing instead]\nTo: ${[].concat(to).join(', ')}\nSubject: ${subject}\n\n${text || html}\n`);
      return { printed: true };
    }
    const info = await transportFor(cfg).sendMail({
      from: cfg.from || cfg.user, to, subject, html, text, replyTo, cc, bcc, attachments,
    });
    return { messageId: info.messageId, info };
  }

  function sendQuietly(message) {
    send(message).catch((err) => logger.warn?.('[blocks mailer] send failed:', err?.message || err));
  }

  async function verify() {
    const cfg = await config();
    if (!cfg.host && !transport) throw new Error('Email is not set up: no SMTP host.');
    await transportFor(cfg).verify();
    return true;
  }

  return { send, sendQuietly, verify };
}
