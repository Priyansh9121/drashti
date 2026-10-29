# Drashti's access list: the protocol, as built (Session 54, E1)

The access list lives in the owner's Google account: a Google Sheet, with the Apps Script project in this
folder bound to it and deployed as a web app ("Execute as: Me", "Who has access: Anyone"). Drashti asks it,
before it opens and every 15 seconds while open, whether this computer is still let in. Setting it up:
`docs/access-setup.md`. The numbers below are in `src/shared/access-protocol.ts` (Drashti's copy) and in
`core.js` (the list's); `src/main/access/list-protocol.test.ts` checks that they agree.

| File              | What it is                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `core.js`         | Every rule, in plain JavaScript with no Google service in it (Apps Script and Node run it).                     |
| `Code.js`         | Apps Script's side: doGet, doPost, the Sheet's Drashti menu, the daily check, Google's services for core.js.    |
| `Setup.html`      | Drashti › Set up…: makes the keys in the owner's browser and shows the one line to send.                        |
| `Link.html`       | The page an Approve or Reject link opens: what it is for, and one button.                                       |
| `appsscript.json` | The manifest: V8, four scopes (this Sheet, sending email, the Sheet's windows, its own daily trigger), web app. |

## Who is who

- **The owner** is the approver: the address in the script's settings (`APPROVER_EMAIL` in Project Settings ›
  Script Properties). It is never in the repository, a test or a log. Only the owner's computer may make the
  owner's calls (the Access List in Drashti).
- **A Gmail** is one person, one row. Addresses are trimmed and lower-cased; for gmail.com and
  googlemail.com the dots and anything after a "+" in the name are dropped for matching (`gmailKey`); the
  address as typed is kept for showing and for email. Any plain ASCII address of any domain is taken.
- **A computer** is `computerId`: the SHA-256 (hex) of `drashti-access:` and the computer's own hardware id
  (Mac: IOPlatformUUID; Windows: MachineGuid), worked out by Drashti at each start. A data folder copied to
  another computer gives another id, so the list answers it `unknown`.
- **A grant** is one computer's way in: made by an approval (or Give access again, or Let me in), with a
  one-time token emailed to the Gmail. The token, used once, binds the grant to that computer until the
  Gmail is revoked. A Gmail may have several computers, each with its own grant. A new grant ends only a
  token not used yet (the newest token is the only one that works), never a computer already in.
- **A length** is how long a Gmail's access lasts (the owner's decision of 28 Oct 2026): `"unlimited"` (until
  revoked) or a whole number of days from 1 to 730 (Drashti offers 1, 7, 30, 60, 90, 120, 180 and 365, or a
  number typed). It counts from when it is given (the approval, Give access again, or a change of length), as
  days of 24 hours by the list's clock, and is the Gmail's, so all its computers end together. The owner's own
  row is always Unlimited. See "How long access lasts" below.
- **A mode** is how a Gmail may use Drashti (the owner's decision of 29 Oct 2026): `"pro"` (Pro Mode and Simple
  Mode) or `"simple"` (Simple Mode only: Drashti holds that computer in Simple Mode, with no way to Pro Mode). It is
  the Gmail's, so all its computers have it. Every Gmail let in before modes came, and the owner's own row, is Pro.
  See "Access by mode" below.

## Calls

Each call is an HTTPS POST to the web app's address (`https://script.google.com/macros/s/<id>/exec`) with a
JSON text body. Google answers a POST with a redirect to a one-time address on
`script.googleusercontent.com`; a GET of that gives the answer. Drashti follows redirects only to
`script.google.com` and `script.googleusercontent.com`, over HTTPS.

Every call carries:

```json
{ "v": 1, "op": "<op>", "nonce": "<32 hex: 128 random bits, new for each call>",
  "computer": { "id": "<64 hex>", "name": "<up to 60 letters>", "version": "1.0.0-alpha.13", "platform": "darwin" },
  "gmail": "<the person's address>", … }
```

Every answer is `{ "payload": "<JSON text>", "sig": "<base64>" }`. `sig` is RSASSA-PKCS1-v1_5 with
SHA-256 over the payload's bytes, made with the list's private key (`SIGNING_KEY`); Drashti checks it with
the public key built into it (`src/shared/access-config.ts`). The payload is ASCII only (everything past
ASCII is written as `\uXXXX`), so its bytes are the same in any character set. It always holds:

```json
{ "v": 1, "op": "<the call's op>", "nonce": "<the call's nonce>", "computerId": "<the call's computer id>",
  "serverTime": 1793000000000, "ok": true, … }
```

or, refused, `"ok": false, "error": "<code>", "message": "<the list's words>"`. Drashti believes an answer
only when the signature is right and the op, nonce and computer id are its own call's: a fake server, an
old answer or another computer's answer is never believed. Before the list is set up it signs nothing.

### Anyone's calls

| op        | adds to the call                   | answers                                                                                                           |
| --------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `request` | `name` (optional)                  | `{ status: "requested", mailed }`; refused `owner-row`, `already-approved`, `too-many`                            |
| `status`  |                                    | `{ status, tokenWaiting }`: `requested`, `approved`, `rejected`, `revoked`, or `unknown`                          |
| `redeem`  | `token`                            | `{ grantId, secret, owner }`; refused `bad-token`, `too-many`                                                     |
| `check`   | `grantId`, `at`, `activity`, `mac` | `{ status, owner, recorded, endsAt, mode, at, grantId, why? }`: `in`, `revoked`, `rejected`, `expired`, `unknown` |

- **request** makes the Gmail's row (or makes it again) **requested**, with a new request id, so the links
  sent before for it are replaced, and emails the approver the Gmail, the name typed, the computer and its
  version, with Approve and Reject links. A row approved with a computer in or a token waiting answers
  `already-approved` (the person uses their token, or the owner gives access again); one approved whose
  token ran out unused, or whose length has ended, is asked for again like any other. `mailed: false` when the day's emails are used
  up: the row is kept all the same, for the owner to see. The owner's own Gmail is never asked for
  (`owner-row`, before anything is counted or read), so nobody's request can make the owner's row
  "requested" again: the owner's way in is Let me in, from the Sheet's menu.
- **status** answers only the computer that made the request (any other gets `unknown`).
  `tokenWaiting`: approved, and a token sent and not used yet.
- **redeem** checks, under the script's lock (so two at once cannot both win), that the row is approved and
  the token is a grant of that Gmail's that is not used, ended or out of date (3 days); then marks it used,
  binds it to this computer, and answers the grant id, this computer's secret and whether it is the owner's.
  Whatever is wrong, the answer is the same `bad-token`. The secret is
  HMAC-SHA-256(`SECRET_KEY`, `drashti-computer-secret\n` + grantId + `\n` + computerId), in hex: the list
  never keeps it, works it out again at each call, and gives it once. Drashti keeps it in its data folder.
- **check**: `mac` = HMAC-SHA-256 with the secret (its 64 hex letters as the key) over
  `drashti-access-v1\n` + the call's canonical JSON without `mac`, in hex. `in` only when the grant is the
  Gmail's, bound to this computer, not ended, the row approved, and the mac right. A wrong mac, another
  computer (a copied data folder), another Gmail or a grant not known: `unknown`. Ended by a revoke:
  `revoked`; by a rejection: `rejected`. Approved, but its length has ended by the list's clock (or the end
  typed in the Sheet cannot be read): `expired`, which ends nothing (a new length lets the same computers back
  in). `owner` is true only for the owner's computer while `in`.
  - `endsAt`: while `in` or `expired`, when the Gmail's access ends (ms, by the list's clock), or null for no
    end. Drashti counts down to it from the answer's own `serverTime`, never by its computer's clock.
  - `mode` (Session 55): `pro` or `simple`, the Gmail's (the owner's own: always `pro`; a computer the list does not
    know: `simple`). A list from before modes came says none, which Drashti reads as `pro`.
  - `at` (Session 55): the call's own `at`, echoed, so the answer Drashti keeps for a start without the internet says,
    signed, when its check was sent; never later than the list's own clock and 5 minutes (Session 55 review: a
    computer's clock set forward for one check gains nothing). Drashti counts its 15 days from it, or from the answer's
    `serverTime` when that is earlier (from `serverTime` alone with a list that echoes none).
  - `grantId` (Session 55 review): the grant whose check this answers, so Drashti believes a kept answer only for the
    grant it keeps now (never one kept for an earlier grant on the same computer).
  - `why` (Session 55): `no-contact` with `unknown` when this computer's grant was ended for no check in 15 days
    (see "15 days with no check"), so Drashti says to ask for access again; a Drashti from before reads the
    status alone.
  - `at`: the time on Drashti's clock (ms). Drashti never sends one smaller than the last it sent for the
    grant (it sends the last one + 1 if its clock went back). A check whose `at` is not above the last one
    recorded records nothing (a replay).
  - `activity`: `{ minutes, shows, streams, recordings, imports }`, each a whole number: this computer's
    **totals since its token was used** (never content, never a file name or a word). Totals, so a lost
    answer or a repeated call never counts anything twice.
  - The list writes the computer's last seen, name, version, platform and totals at most once a minute
    (`recorded: true` when it did), and the Gmail's row's sums with them: for any computer still in that checks,
    whatever the Gmail's status (one whose length has ended keeps asking by itself, so it is never ended for no
    contact; Session 55).
  - A computer's signed checks closer together than 5 seconds are answered as any other (a Drashti quit
    and started again at once is answered at once), but only one in 5 seconds counts: the others record
    nothing. Only signed ones count, so nobody else can use a computer's up.

### The owner's calls

Signed exactly as `check` is (`grantId`, `at`, `mac`), from a computer let in with the approver's own Gmail.
Anyone else gets `not-owner`. The Gmail acted on is `target`.

| op        | adds                                           | does                                                                                                                         |
| --------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `list`    |                                                | `{ people: [...] }`, every Gmail (see below)                                                                                 |
| `add`     | `target`, `name?`, `note?`, `length?`, `mode?` | the row **requested**, its Length and Mode kept for the approval (Simple when none), and the approver's email (`mailed`)     |
| `approve` | `target`, `length?`, `mode?`                   | approved for `length` from now with `mode` (the row's when none), a new token emailed; `already-approved` for a row approved |
| `regrant` | `target`, `length?`, `mode?`                   | Give access again: approved for `length` from now (the row's mode kept unless one is given), a new token emailed             |
| `length`  | `target`, `length`                             | an **approved** row's length, counted from now: `{ status, endsAt }`; `wrong-status` else                                    |
| `reject`  | `target`                                       | a **requested** row rejected, the person told by email; refused `wrong-status` otherwise                                     |
| `revoke`  | `target`                                       | an **approved** row revoked: every computer of that Gmail ends at once (and a token waiting)                                 |
| `note`    | `target`, `note`                               | the row's note (up to 500 letters)                                                                                           |
| `mode`    | `target`, `mode`                               | the row's mode (`pro` or `simple`), any status: `{ status, mode }`; its computers hear it at their next check                |

`approve` and `regrant` answer `{ status, runsOut, endsAt }`. A `length` not given is Unlimited (`length` itself
needs one: `bad-request`); one the list does not give is refused `bad-length`, before anything is changed.
`reject`, `revoke` and `length` never touch the owner's own row (`owner-row`), nor does any length but Unlimited, nor
any mode but `pro`. A mode not `pro` or `simple` (or none, for `mode`) is `bad-request`.
A Gmail with no row: `not-found`.
`approve`, `regrant` and Let me in change nothing when the email cannot go: `mail-limit` when the day's
emails are used up, `mail-failed` when sending fails (the token sent before still works). The list's own log (in the
owner's Apps Script) says "Mail to a Gmail failed", never the Gmail, even where Google's words name it (Session 55
review).

Each of `list`'s people: `{ gmail, name, status, owner, requestedAt, approvedAt, rejectedAt, revokedAt,
lastSeen, version, minutes, shows, streams, recordings, imports, note, length, endsAt, ended, endsUnreadable,
computers: [{ name, version, platform, lastSeen, usedAt, ended, endedWhy }], token: { sentAt, runsOut } | null,
request: { computer, at } | null, mode }`, dates in ms (or null), in the Sheet's order, one per Gmail. `mode`: the
Gmail's, or for a request waiting the one its approval would give. `endedWhy`: `revoked`, `rejected`, `replaced`, or
`no-contact` (Session 55). Asked, `list` first ends every computer with no check for 15 days. `length`: the
one last given (or chosen adding the Gmail), or null; `endsAt`: the end, or null for none; `ended`: approved and
past its end by the list's clock (or its end cannot be read: `endsUnreadable`). The answer's `serverTime` is the
list's clock, for how long is left.

### Refusals

`bad-request` (not a call of this version), `bad-gmail`, `too-many`, `busy` (the script's lock was not had in
10 seconds), `not-set-up`, `already-approved`, `bad-token`, `not-owner`, `owner-row`, `not-found`,
`wrong-status`, `bad-length` (not Unlimited, nor 1 to 730 whole days), `mail-limit`, `mail-failed`, `server`. Drashti shows its own words for each
(`ACCESS_ERROR_TEXT`).

### Canonical JSON

What a mac is made over, made the same by both sides (`canonicalJson`): objects with their keys in sorted
order (JavaScript's default sort), keys whose value is undefined left out, no spaces, strings and numbers as
`JSON.stringify` writes them, and then every UTF-16 unit past ASCII (from U+007F) written as `\uXXXX` in
lower-case hex.

### Limits

| What                              | Limit                  |
| --------------------------------- | ---------------------- |
| Requests for one Gmail            | 3 a day                |
| Requests from one computer        | 10 a day               |
| Requests in all                   | 50 a day               |
| Tries of a token, one Gmail       | 10 an hour             |
| Tries of a token, one computer    | 10 an hour             |
| One computer's counted checks     | one every 5 seconds    |
| A computer's last seen and totals | written once a minute  |
| The Sheet as read for checks      | at most 10 seconds old |

The day's requests are counted in the script's settings (`REQUESTS_TODAY`: a day by the list's clock, in
UTC; in all, and for each Gmail and computer by a short hash), under the script's lock; a request refused is
never counted, so it stays a few KB. The hour's token tries are counted in Apps Script's cache (Google may
empty it, which only forgets a count; nothing there lasts past 6 hours).

## Tokens

28 letters of Crockford's base32 (`0-9`, `A-Z` without I, L, O and U): 140 random bits, emailed in groups of
four (`ABCD-EFGH-…`). Typed, they are read in capitals without spaces or dashes, O as 0 and I or L as 1. The
Sheet keeps only SHA-256(`drashti-token\n` + the token). A token works once, only for its own Gmail, never
after a revoke or a newer grant, and runs out 3 days after it is sent. Randomness in Apps Script:
`Utilities.getUuid` (Java's `UUID.randomUUID`, a strong generator), two at a time through SHA-256.

## How long access lasts

- **Given** with each approval (an Approve link's page, or the Access List's Approve or Add), with Give access
  again, and changed for a Gmail approved (the `length` call). Unlimited is chosen at first everywhere, so
  nobody is cut off by a slip; approving a Gmail the owner added with a length offers that one first.
- **The end** is the moment given plus the length's days of 24 hours, by the list's clock (Google's), written in
  the Sheet's **Access ends** as a date and time (or `Unlimited`). The list alone says whether it has come: a
  check after it answers `expired`. Drashti counts down to `endsAt` from each answer's `serverTime` on its own
  monotonic clock, so changing a computer's clock changes nothing; its next check comes a moment after the
  end at the latest.
- **When it comes**, the Gmail's computers stop as a revoke stops them, but nothing is ended: a new length
  (`length`, or Give access again) lets the same computers back in at their next check; a Drashti started
  again asks by itself every 15 seconds until one comes. The person may also ask again (`request` takes a row
  whose length has ended).
- **The owner's own row** never ends: no length is given to it (`owner-row`), and an end typed on it is never
  read.

## Access by mode (the owner's decision of 29 Oct 2026)

- **Chosen** on the Approve page (Simple Mode only, chosen at first; Pro Mode and Simple Mode when the owner chose it
  adding the Gmail), in Drashti's Access List (Add a Gmail and Approve ask, Simple first; Change the mode… on any row
  but the owner's: the `mode` call), or typed in the Sheet's **Mode** column (Pro or Simple: the Sheet takes no
  other). A new Gmail asked for (`request`) is made Simple, and one already on the list keeps its own whoever asks
  (Session 55 review: anyone may ask for any Gmail, so only the owner changes a mode); `add` writes the one chosen, or
  Simple when none is said. The Approve page, Drashti's Approve… and an approval with no mode start on Simple all the
  same, unless the owner chose Pro adding the Gmail (Session 55 review, N2: a Gmail that had Pro and asks again is
  offered Simple first; its row keeps Pro until the owner approves). Give access again (`regrant`) takes a mode as
  Approve does (Drashti's Access List asks, the row's own first), and keeps the row's when none is said.
- **Read**: only `Pro` is Pro; `Simple`, empty or anything else is Simple (Session 55 review: it fails closed). The
  owner's own row is always Pro, whatever is typed on it. Every Gmail let in before modes came is written `Pro` when the
  list first makes the column (below).
- **Each check's answer carries it**, so a change reaches a computer at its next check: Drashti drops to Simple Mode
  at that answer, and Pro access again brings Pro Mode back by itself when the access had put it in Simple Mode.

## 15 days with no check (the owner's decision of 29 Oct 2026)

- A computer let in whose last check (or its token's use, when it never checked) is 15 days old or more by the list's
  clock (`stopAfterMs`, the same number Drashti keeps working for without an answer) has its grant ended,
  `endedWhy: no-contact`: at its next check (answered `unknown`, `why: no-contact`), when the owner's Access List is
  asked (`list`), and by **the daily check**, whichever comes first. The Access List shows it ended, "No contact for
  15 days"; **Give access again** (`regrant`) sends a new token, and the person may ask again (`request` no longer
  answers `already-approved` for such a computer).
- **The daily check** is a time-driven trigger the owner turns on once, from the Sheet: **Drashti › Turn on the daily
  check…** makes one trigger that runs `drashtiDailyCheck` every day at about 3 in the morning (the Sheet's time zone),
  and asked again says it is on. Google asks the owner once to allow the scope it needs
  (`https://www.googleapis.com/auth/script.scriptapp`, "Allow this application to run when you are not present").
  Free, as every Apps Script trigger is. A web page the script serves can call `drashtiDailyCheck` by name: it then
  does only what its rule says, at most once in 10 minutes, and returns nothing (Session 55 review).

## Approve and Reject links

`<web app>?a=approve|reject&r=<request id>&x=<expiry, ms>&s=<HMAC-SHA-256(LINK_KEY, "drashti-link\n" + a +
"\n" + r + "\n" + x), hex>`, made with each request, running out after 7 days. Opening one (doGet) shows a page
saying what it is for, with ONE button; nothing changes until it is pressed (Link.html calls `answerLink`
through `google.script.run`, which checks the link again under the lock), so an email scanner opening it does
nothing. An Approve page also asks how long access lasts (Unlimited chosen, or the length the owner chose
adding the Gmail), and sends the length chosen with the button (`length`: `unlimited`, or the days as text);
the list checks it again, and a length it does not give changes nothing. It asks what they may use too
(Session 55): Simple Mode only (chosen at first) or Pro Mode and Simple Mode (chosen at first when the owner chose
Pro adding the Gmail), sent as `mode` (`simple` or `pro`); none sent, the row's; any other refused. A link used (either of the two), out of date, for a request since replaced (asked again, or the row
removed), or forged says so plainly. Approve emails the person a token; Reject marks the row rejected and
tells the person in a short email.

## The Sheet

Two tabs, made by Drashti › Set up… (which also puts back a column taken away):

- **Access List**, one row per Gmail: Gmail, Name, Status (a list: requested, approved, rejected, revoked),
  Requested, Approved, Rejected, Revoked, Access ends, Mode (a list: Pro, Simple), Computers (the names of those in),
  Version, Last seen, Minutes used, Shows, Streams, Recordings, Imports, Note; and, hidden, the list's own: Request,
  Request from, Request computer, Request at, Answered, Status seen, Length.
- **Computers**, one row per grant (protected with a warning): Gmail, Computer, Version, Platform, Last seen,
  Minutes used, Shows, Streams, Recordings, Imports, Token sent, Token used, Ended, Why ended; and, hidden,
  Grant, Token hash, Computer id, Last at.

**Access ends** and **Length** came after the first Sheets were set up (28 Oct 2026), and **Mode** after them (29 Oct
2026): the list adds each itself, after the last column, the first time it reads a Sheet without it (Length hidden,
Access ends shown as dates and written `Unlimited` for each Gmail approved then; Mode taking Pro or Simple only and
written `Pro` for each Gmail but a request waiting), so the owner never sets the Sheet up again for them. Set up… on a
Sheet with Gmails in it leaves the Mode column to the list. **Mode is made once** (Session 55 review): the list keeps
`MODE_COLUMN_MADE` in the script's settings when it, or Set up…, makes it; taken away or renamed after that, the column
is put back empty, which reads Simple for every Gmail but the owner's (it fails closed, and the list's log says so),
never `Pro` again for every Gmail.

Columns are found by their headers, so the owner may sort, move or add columns. **A status changed in the
Sheet counts as the list's own** once the list reads the Sheet again (within 10 seconds of the next call
about that Gmail): revoked or rejected stops that Gmail's computers at their next check and ends their
grants (so setting approved again later lets none of them back in: Give access again does); its date is
written. Setting approved by hand sends no token (Approve links and the Access List do). A status the list
does not know stops the computers without ending them. **Access ends typed in the Sheet counts too**: a date and
time is the new end; empty or `Unlimited` is no end; anything else the list cannot read stops that Gmail's
computers (`expired`) without ending them, until it is put right. A second row for the same Gmail is never read.

## Keys (Script Properties, in the owner's account only)

| Property           | Made by                                     | What                                           |
| ------------------ | ------------------------------------------- | ---------------------------------------------- |
| `APPROVER_EMAIL`   | the owner, by hand                          | the approver's (owner's) Gmail                 |
| `WEB_APP_URL`      | Set up… (pasted by the owner)               | the web app's address, for the links in emails |
| `SIGNING_KEY`      | Set up…, in the owner's browser (WebCrypto) | RSA 2048 private key, PKCS#8 PEM               |
| `PUBLIC_KEY`       | Set up…                                     | its public half, SPKI in base64                |
| `LINK_KEY`         | Set up… (256 random bits, hex)              | signs the Approve and Reject links             |
| `SECRET_KEY`       | Set up… (256 random bits, hex)              | each computer's secret comes from it           |
| `SETUP_TICKET`     | Set up…, for its window only (30 minutes)   | the only way the window's two calls are taken  |
| `REQUESTS_TODAY`   | the list, at each request                   | the day's requests counted (see Limits)        |
| `MODE_COLUMN_MADE` | the list or Set up…, once                   | the Mode column was made (see The Sheet)       |

Set up… never replaces a key (every Drashti would stop): opened again, it shows the same line. Before it keeps
them, its window has Google sign, HMAC and hash a test text and checks each against the browser's own. The
list reads its settings at most once every 10 minutes (Apps Script's cache).

## What a web page can call

A page the script serves can call any of its global functions by name (`google.script.run`), running as the
owner. So `core.js` makes one global object and no function; `Code.js`'s functions end with `_` (never
callable) except `doGet`, `doPost`, `answerLink` (it checks the link's signature), `drashtiTestKeys` and
`drashtiSaveSetup` (they need Set up…'s one-time ticket), `onOpen`, `drashtiSetUp`, `drashtiLetMeIn` and
`drashtiDailyOn`, which do nothing outside the Sheet's own window (`SpreadsheetApp.getUi()` fails anywhere else), and
`drashtiDailyCheck` (the daily trigger's), which does only what its rule says, at most once in 10 minutes, and returns
nothing (Session 55 review).
`src/main/access/list-code.test.ts` keeps that list.

## Tests

`tests/access-core.ts` runs `core.js` with Google's services made in memory; `tests/access-standin.ts` is the
stand-in list on 127.0.0.1 that every end-to-end test uses; `src/main/access/list-core.test.ts`,
`list-code.test.ts`, `list-protocol.test.ts` and `standin.test.ts` are the unit tests. Placeholder addresses
only (`placeholder.user@example.com`, `owner.placeholder@example.com`).
