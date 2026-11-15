# Sign-in and email

`@mn/blocks/server` is AutoDealer's sign-in (its `docs/decisions/auth.md`) made
app-agnostic. These rules are why it is shaped the way it is; keep them.

**The session is a JWT in an httpOnly cookie.** Never localStorage: page
script, an XSS or an extension can read localStorage, but it cannot read an httpOnly cookie.

**Two timeouts.** Each token lives `idleMinutes` (30) and every real request
re-issues it. A request carrying `X-Background-Request: 1` (polling) is
authenticated but does not renew, or an unattended tab would never time out.
Re-issuing stops `maxHours` (8) after sign-in, however active.

**Logout ends every session on every device.** A JWT can't be cancelled, so
each carries the user's `token_version` and every request checks it (one
indexed query). Logout and password changes bump it. The same lookup means a
deleted user or a role change takes effect on the next request.

**Google proves identity, not access.** A verified Google email gets in only
if it is already a user, unless the app turns on `signup` and supplies
`createUser`. The same goes for an emailed code; the login page's sign-up form
sends a name with the code, used only when the account is created. Tokens are
checked against Google's keys with `jose`, with no Google SDK.

**Email codes follow AutoDealer's customer portal:**
- 6 digits, live 10 minutes, and only the newest code counts.
- 5 wrong guesses kill a code.
- One address gets at most 3 codes per 15 minutes.
- Only an HMAC of the code is stored.
- `POST /code` answers the same whether or not the email has an account.

**Forgot password = sign in with a code.** For 15 minutes after a code
sign-in, `POST /password` needs no current password; otherwise it does. The
change bumps `token_version` (other devices are signed out), keeps this
device signed in, and emails a "password changed" notice.

**Rate limits are per category** (login 10, code request 8, code verify 15,
per 15 minutes per IP), in memory. That is right for single-process apps; pass a
shared `store` if an app ever runs more than one instance.

**Email is HTML plus text, from one layout.** `renderEmail` uses tables and inline
styles because that is what Gmail, Outlook and Apple Mail render alike. It
escapes every value and drops any link that is not http(s). With no SMTP host
outside production, the mailer prints the email to the console, so code sign-in
works locally with no setup.
