/*
 * A complete, runnable example of the server kit. Start it with
 *   npm run example          (API on :3009)
 *   npm run dev              (demo on :5173, proxies /api to it; open the Login tab)
 * Sign in as demo@example.com / demo-password, or use "Email me a code":
 * with no SMTP set, the code is printed in this terminal.
 * Email previews: http://localhost:3009/emails
 * Q&A board API: /api/qa (QaBoard apiBase="/api/qa")
 */
import express from 'express';
import {
  createAuth, memoryUserStore, hashPassword, createMailer,
  loginCodeEmail, passwordChangedEmail, inviteEmail, notificationEmail,
} from '../server/index.js';
import { qaRouter, memoryQaStore } from '../server/qa.js';

const brand = { appName: 'Blocks demo', color: '#1a56db', url: 'http://localhost:5173' };
const users = memoryUserStore([
  { email: 'demo@example.com', name: 'Demo', role: 'admin', passwordHash: await hashPassword('demo-password') },
]);
const mailer = createMailer();
const auth = createAuth({
  secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me-0123456789abcdef',
  users,
  mailer,
  brand,
  google: process.env.GOOGLE_CLIENT_ID ? { clientId: process.env.GOOGLE_CLIENT_ID } : null,
});

const app = express();
app.use('/api/auth', auth.router);
app.get('/api/secret', auth.requireAuth, (req, res) => res.json({ message: `Hi ${req.user.email}` }));
// Q&A board: anyone can read, signed-in people post; demo@example.com is an admin, so a moderator.
app.use('/api/qa', express.json(), auth.optionalAuth, qaRouter({ store: memoryQaStore(), onEvent: (type, d) => console.log(`[qa] new ${type}`, d.question?.title || '') }));

const previews = {
  'login-code': () => loginCodeEmail({ brand, code: '482913' }),
  'password-changed': () => passwordChangedEmail({ brand }),
  invite: () => inviteEmail({ brand, inviter: 'Michael', url: 'https://example.com/login' }),
  notification: () => notificationEmail({
    brand, title: 'New lead: 2019 Toyota Tacoma', intro: 'Someone asked about a truck on the website.',
    rows: [['Name', 'Ana Lopez'], ['Phone', '(214) 555-2415'], ['Message', 'Is it still available?']],
    button: { label: 'Open lead', url: 'https://example.com/admin/leads/42' },
  }),
};
app.get('/emails', (_req, res) => res.send(Object.keys(previews).map((k) => `<p><a href="/emails/${k}">${k}</a></p>`).join('')));
app.get('/emails/:name', (req, res) => {
  const make = previews[req.params.name];
  if (!make) return res.status(404).send('No such email');
  res.type(req.query.text ? 'text/plain' : 'html').send(req.query.text ? make().text : make().html);
});

app.listen(3009, () => console.log('Blocks example API on http://localhost:3009  (emails: /emails)'));
