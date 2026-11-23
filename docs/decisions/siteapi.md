# siteapi (`@mn/blocks/siteapi`, `ops/siteapi.mjs`)

Turns a website with no public API into something a job can call, by finding
and calling the site's **own internal JSON API**. Scraping HTML is the fallback,
not the plan. The `/siteapi` Claude skill drives the workflow; this is the code.
These rules explain why it's shaped this way; keep them.

**Hidden API first.** Modern sites fetch their data as JSON. Calling that is
roughly 100× faster than a browser, gives exact fields (ids, prices, VINs) and
breaks less often than CSS selectors. `analyzeHar` finds those calls;
`--find "<text on the page>"` is the strongest signal for which one holds the
data. JSON embedded in the HTML (`__NEXT_DATA__`, ld+json) comes next. A
Playwright scraper comes last.

**Least auth that works.** `probeRequest` replays a call with no headers, then
browser headers, then cookies, then everything that was captured. The client
sends only what's needed, so there's less to expire and less secret material
stored.

**Secrets never in a repo.** Cookies and tokens live in
`~/.config/siteapi/<site>.env` (or `<SITE>_KEY` env vars). Captures and full
requests go to `~/.config/siteapi/out/<site>/`, outside every repo, because
they contain cookies. `endpoints.json` lists header names, never values.

**Logged-in sites use the automation Chrome.** `captureHar({ chrome: true })`
opens a new tab in the signed-in `~/ChromeAutomation` profile through
`@mn/blocks/browser` (all of browser.md applies: 127.0.0.1 only, never touch the
user's tabs, close the tab after). No passwords are stored anywhere.

**Polite by default.** `siteFetch` sends one request at a time with `minGap`
(1s) between them, even when callers fire in parallel. Don't lower it to scrape
faster.

**Read-only.** Site clients read data. Calls that buy, bid, post, delete or
message are written only when the user asks for one, and the user confirms
before it runs.

**Report walls, don't beat them.** If nothing works in `probeRequest` (signed
requests, Cloudflare/Akamai/PerimeterX, single-use tokens), or a call starts
returning HTML (`SiteApiError.expired`), say so and refresh the session or fall
back to scraping. No anti-bot evasion.

**Respect each site's terms.** Use it for data you're allowed to see. If a
site's terms clearly forbid automated access, say so once and let Michael decide.
