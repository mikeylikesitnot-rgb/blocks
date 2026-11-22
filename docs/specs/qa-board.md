# Q&A board (BLK-036, BLK-037) — approved 2026-11-22

Built in Blocks, not as a standalone server: each app mounts the board on its own
sign-in, Postgres and look; boards stay separate per app. A shared board later is
a tiny app mounting the same `qaRouter`.

## BLK-036 Q&A server
As the owner, I want a server piece any app mounts to run a Stack Overflow-style board on its existing sign-in, so every app gets one without rebuilding it.

1. Signed-in users post, edit and delete their own questions (title 15–150, rich body, 1–5 tags) and answers; others get 403; moderators (role `admin` by default) can act on any.
2. Vote +1/−1 on questions and answers, one per person, clicking again removes it, no voting on your own post; the new score comes back.
3. The asker marks one accepted answer (can switch or unmark).
4. Comments on questions and answers, plain text, up to 600 characters.
5. List sorts Newest / Active / Votes / Unanswered, filters by tag, searches title and body (Postgres full-text), pages; views count once per person.
6. Bodies cleaned with `cleanRich`, writes rate-limited, schema SQL idempotent.

## BLK-037 Q&A screens
As the owner, I want one drop-in `<QaBoard>`, so an app adds a board with one route and one import.

1. List: score, answer count, views, title, tags, author and time; sort, tag filter and search above it, kept in the URL; cards on phones.
2. Ask: title, editor, tag box suggesting existing tags; errors per field.
3. Question page: vote arrows, accepted answer pinned first with a green check, other answers by votes, comment threads, answer editor at the bottom.
4. Edit and delete own posts (confirm before delete); moderators on any post.
5. Keyboard-usable votes (aria-pressed); light and dark at 390px and 1280px.
6. Loading, empty and error states.

## Decisions (defaults accepted)
- Reading: the app decides (mount behind `requireAuth` or `optionalAuth`); posting needs sign-in.
- Moderators close and reopen; no duplicate or close votes.
- Edits in place with an "edited" time; no history.
- A question with answers is deleted only by a moderator.

## Not doing
Reputation and badges, image uploads in posts, email notifications (the router's `onEvent` hook lets an app send them with `notificationEmail`), wiring into apps (separate bumps).
