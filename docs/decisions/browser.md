# Browser (`@mn/blocks/browser`)

Lets a scheduled job on Michael's Mac read pages behind a login by driving a
Chrome that is already running and already signed in. These rules are why it is
shaped the way it is; keep them.

**Connect to a running Chrome, don't launch one.** `chromium.connectOverCDP`
attaches to Chrome over the DevTools protocol, so the job uses the logins the
browser already holds. No passwords or cookies are stored in an app or repo.

**A separate profile, not the everyday one.** Since Chrome 136,
`--remote-debugging-port` is ignored on the default profile. The block uses a
dedicated folder (`~/ChromeAutomation`) that is signed in to the needed sites
once and stays signed in. Side benefit: the job can never see the everyday
profile's mail or banking.

**Bind to 127.0.0.1 only.** Anyone who can reach the debug port controls the
logged-in browser (read any page, act as the user). Headed Chrome binds
loopback by default; `--remote-debugging-address` is only honoured in headless
mode, so we pass it as belt and braces but do not rely on it. Never forward or
expose the port (no `0.0.0.0`, no ssh `-R`, no tunnel). The start scripts also
refuse to treat a port as "ours" unless the automation profile's
`DevToolsActivePort` file names it.

**It runs on the Mac, not the VPS.** The logged-in profile lives on the Mac. A
launchd job runs the helper there and pushes results to the server; the server
never gets a browser session.

**Downloads while connected.** While a job is connected over CDP, a manual
download in the automation profile lands in Playwright's temp folder, not
Downloads. `downloadText` reads it from there.

**Never touch the user's tabs.** `withPage` opens a new tab, always closes it
(even when the callback throws) and only disconnects the browser, so Chrome and
the person's own tabs stay as they were.

**Report a login wall, don't scrape it.** `needsLogin` lets a job say "log in
to the automation profile" instead of parsing a sign-in page as data.

**Respect each site's terms.** Read what you are allowed to read, at a human
pace, on a schedule that is not abusive. Prefer an export or an official API
where one exists (`downloadText` covers "click Export, read the file").

**Stagehand is optional and not bundled.** If a page is too messy for
selectors, an app can add Stagehand (`page.extract` / `page.act`) on top of the
page `withPage` hands over. Blocks stays dependency-light: `playwright-core` is
an optional peer, loaded only when connecting.
