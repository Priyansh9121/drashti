/*
 * Drashti's access list (Session 54, E1): every rule of who may use Drashti, in one file. Plain JavaScript
 * with no Google service in it, so the same file runs in the owner's Google account (Apps Script, beside
 * Code.js, which hands it the Sheet, the mail and the rest through `env`) and in Node, for the unit tests
 * and the stand-in list the end-to-end tests use (tests/access-standin.ts). PROTOCOL.md says in words what
 * it answers; src/shared/access-protocol.ts is Drashti's copy of the numbers (a unit test checks they agree).
 *
 * In Apps Script every file shares one global scope, and a web page the script serves can call any of its
 * global functions by name (google.script.run). So this file makes one global name, DrashtiAccess, an
 * object and never a function: nothing here can be called from a page.
 *
 * `env` (Code.js makes it from Google's services; the tests from Node's):
 *   now()                       the time, ms since 1970
 *   randomBytes(n)              n random bytes (0 to 255)
 *   sha256Hex(text)             SHA-256 of the text's UTF-8 bytes, hex (every text given is ASCII)
 *   hmacHex(key, text)          HMAC-SHA-256, hex
 *   sign(text)                  RSA-SHA-256 (PKCS#1 v1.5) with the signing key, over UTF-8, base64
 *   formatTime(ms)              a time for an email or a page, in the Sheet's time zone
 *   props()                     { approverEmail, webAppUrl, linkKey, secretKey, hasSigningKey }
 *   properties.get(key), properties.set(key, value)   the script's settings, read and written as they are
 *   mail.remaining()            emails the account may still send today
 *   mail.send({ to, subject, body })
 *   lock(fn)                    fn under the script's lock (throws when it cannot be had in time)
 *   flush()                     the Sheet's pending writes, written
 *   cache.get(key), put(key, value, seconds), remove(key), getAll(keys), putAll(values, seconds)
 *   sheet.read(tab)             every cell of a tab (the header row first)
 *   sheet.row(tab, row), sheet.column(tab, col), sheet.write(tab, row, col, value),
 *   sheet.append(tab, values)   rows and columns count from 1, as the Sheet's; append answers the row
 *   log(text)                   optional
 */
var DrashtiAccess = (function () {
  'use strict';

  var MINUTE = 60 * 1000;
  var HOUR = 60 * MINUTE;
  var DAY = 24 * HOUR;

  /** The numbers both sides keep to (src/shared/access-protocol.ts; list-core.test.ts checks they agree). */
  var PROTOCOL = {
    version: 1,
    checkEveryMs: 15 * 1000,
    // Drashti's own: with no answer, it keeps working this long from the last answer (the list never uses it).
    stopAfterMs: 60 * MINUTE,
    tokenMs: 3 * DAY,
    linkMs: 7 * DAY,
    limits: {
      requestsPerGmailPerDay: 3,
      requestsPerComputerPerDay: 10,
      requestsPerDay: 50,
      redeemsPerGmailPerHour: 10,
      redeemsPerComputerPerHour: 10,
      checkGapMs: 5 * 1000,
      recordGapMs: MINUTE,
      cacheMs: 10 * 1000,
    },
    publicOps: ['request', 'status', 'redeem', 'check'],
    ownerOps: ['list', 'add', 'approve', 'reject', 'revoke', 'regrant', 'note', 'length'],
    statuses: ['requested', 'approved', 'rejected', 'revoked'],
    checkStatuses: ['in', 'revoked', 'rejected', 'expired', 'unknown'],
    requestStatuses: ['requested', 'approved', 'rejected', 'revoked', 'unknown'],
    errors: [
      'bad-request',
      'bad-gmail',
      'too-many',
      'busy',
      'not-set-up',
      'already-approved',
      'bad-token',
      'not-owner',
      'owner-row',
      'not-found',
      'wrong-status',
      'bad-length',
      'mail-limit',
      'mail-failed',
      'server',
    ],
    // In two parts, so no secret scanner reads the letters as a secret.
    tokenAlphabet: '0123456789' + 'ABCDEFGHJKMNPQRSTVWXYZ',
    tokenLength: 28,
    macPrefix: 'drashti-access-v1\n',
    // How long access lasts (the owner's decision of 28 Oct 2026): these days, any whole number of days up to
    // maxDays typed in, or 'unlimited' (until revoked); each counted from when it is given, by the list's clock.
    lengths: { days: [1, 7, 30, 60, 90, 120, 180, 365], maxDays: 730 },
  };

  /** The list's own words with each refusal (Drashti shows its own; these are for anyone reading the answer). */
  var MESSAGES = {
    'bad-request': 'The list did not understand the request.',
    'bad-gmail': 'That is not an email address the list takes.',
    'too-many': 'Too many tries for now; wait a while, then try again.',
    busy: 'The list is busy; try again in a moment.',
    'not-set-up': 'The list is not set up yet (Drashti › Set up… in its Sheet).',
    'already-approved': 'This Gmail is already approved.',
    'bad-token': 'That token does not work.',
    'not-owner': 'Only the owner’s computer can do that.',
    'owner-row':
      'The owner’s own row is never asked for, rejected or revoked: the owner’s way in is Drashti › Let me in (the owner)… in the Sheet.',
    'not-found': 'That Gmail is not on the list.',
    'wrong-status': 'That cannot be done to this Gmail as it is now.',
    'bad-length': 'That is not a length of access the list gives: 1 to 730 whole days, or Unlimited.',
    'mail-limit': 'The list has sent all the emails it may send today; try again tomorrow.',
    'mail-failed': 'The list could not send the email; try again later.',
    server: 'Something went wrong in the list; try again in a moment.',
  };

  /** The Sheet: one row per Gmail, and one row per computer let in (each grant). */
  var PEOPLE = 'Access List';
  var COMPUTERS = 'Computers';
  var TABLES = {};
  TABLES[PEOPLE] = [
    { field: 'gmail', header: 'Gmail' },
    { field: 'name', header: 'Name' },
    { field: 'status', header: 'Status' },
    { field: 'requestedAt', header: 'Requested', date: true },
    { field: 'approvedAt', header: 'Approved', date: true },
    { field: 'rejectedAt', header: 'Rejected', date: true },
    { field: 'revokedAt', header: 'Revoked', date: true },
    // When access ends (a time, or Unlimited); typed in the Sheet, it counts. `added`: the list adds the column
    // itself to a Sheet set up before it came (addColumns), so nobody sets the Sheet up again for it.
    { field: 'endsAt', header: 'Access ends', ends: true, added: true },
    { field: 'computers', header: 'Computers' },
    { field: 'version', header: 'Version' },
    { field: 'lastSeen', header: 'Last seen', date: true },
    { field: 'minutes', header: 'Minutes used', number: true },
    { field: 'shows', header: 'Shows', number: true },
    { field: 'streams', header: 'Streams', number: true },
    { field: 'recordings', header: 'Recordings', number: true },
    { field: 'imports', header: 'Imports', number: true },
    { field: 'note', header: 'Note' },
    // The list's own bookkeeping (hidden by Set up…): the request waiting, and the status it last wrote,
    // so a status typed in the Sheet is noticed.
    { field: 'requestId', header: 'Request', hidden: true },
    { field: 'requestFrom', header: 'Request from', hidden: true },
    { field: 'requestComputer', header: 'Request computer', hidden: true },
    { field: 'requestAt', header: 'Request at', date: true, hidden: true },
    { field: 'answered', header: 'Answered', hidden: true },
    { field: 'statusSeen', header: 'Status seen', hidden: true },
    // The length last given (or chosen when the owner added the Gmail, for its approval): days, or 'unlimited'.
    { field: 'length', header: 'Length', length: true, hidden: true, added: true },
  ];
  TABLES[COMPUTERS] = [
    { field: 'gmail', header: 'Gmail' },
    { field: 'computerName', header: 'Computer' },
    { field: 'version', header: 'Version' },
    { field: 'platform', header: 'Platform' },
    { field: 'lastSeen', header: 'Last seen', date: true },
    { field: 'minutes', header: 'Minutes used', number: true },
    { field: 'shows', header: 'Shows', number: true },
    { field: 'streams', header: 'Streams', number: true },
    { field: 'recordings', header: 'Recordings', number: true },
    { field: 'imports', header: 'Imports', number: true },
    { field: 'sentAt', header: 'Token sent', date: true },
    { field: 'usedAt', header: 'Token used', date: true },
    { field: 'endedAt', header: 'Ended', date: true },
    { field: 'endedWhy', header: 'Why ended' },
    { field: 'grantId', header: 'Grant', hidden: true },
    { field: 'tokenHash', header: 'Token hash', hidden: true },
    { field: 'computerId', header: 'Computer id', hidden: true },
    { field: 'lastAt', header: 'Last at', number: true, hidden: true },
  ];

  var ACTIVITY = ['minutes', 'shows', 'streams', 'recordings', 'imports'];

  // ---- small things ----

  function hasOwn(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }

  function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  /** A refusal, thrown and answered: { ok: false, error, message }. */
  function refusal(code, message) {
    return { refusal: code, message: message || MESSAGES[code] || '' };
  }

  function isRefusal(e) {
    return isObject(e) && typeof e.refusal === 'string';
  }

  function hex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += ('0' + (bytes[i] & 255).toString(16)).slice(-2);
    return out;
  }

  /** The same text, compared in the same time whatever differs (a mac, a link's signature, a hash). */
  function sameText(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    var d = 0;
    for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  }

  /** Every UTF-16 unit past ASCII as \uXXXX (src/shared/access-protocol.ts's asciiOnly). */
  function asciiOnly(text) {
    return text.replace(/[\u007f-\uffff]/g, function (c) {
      return '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  function canonical(value) {
    if (value === null) return 'null';
    if (Array.isArray(value))
      return (
        '[' +
        value
          .map(function (v) {
            return v === undefined ? 'null' : canonical(v);
          })
          .join(',') +
        ']'
      );
    switch (typeof value) {
      case 'string':
        return JSON.stringify(value);
      case 'number':
        if (!isFinite(value)) throw refusal('bad-request');
        return JSON.stringify(value);
      case 'boolean':
        return value ? 'true' : 'false';
      case 'object':
        return (
          '{' +
          Object.keys(value)
            .filter(function (k) {
              return value[k] !== undefined;
            })
            .sort()
            .map(function (k) {
              return JSON.stringify(k) + ':' + canonical(value[k]);
            })
            .join(',') +
          '}'
        );
      default:
        throw refusal('bad-request');
    }
  }

  /** src/shared/access-protocol.ts's canonicalJson: what a signed call's mac is made over. */
  function canonicalJson(value) {
    return asciiOnly(canonical(value));
  }

  /** src/shared/access-protocol.ts's gmailKey: the one form of an address the list matches on. */
  function gmailKey(address) {
    var a = String(address === null || address === undefined ? '' : address)
      .trim()
      .toLowerCase();
    var at = a.lastIndexOf('@');
    if (at < 1 || at === a.length - 1) return '';
    var local = a.slice(0, at);
    var domain = a.slice(at + 1);
    if (domain === 'googlemail.com') domain = 'gmail.com';
    if (domain === 'gmail.com') local = local.split('+')[0].replace(/\./g, '');
    return local === '' ? '' : local + '@' + domain;
  }

  var GMAIL_SHAPE = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

  function gmailShaped(address) {
    var a = String(address).trim().toLowerCase();
    return a.length <= 254 && GMAIL_SHAPE.test(a) && gmailKey(a) !== '';
  }

  /** A token as typed, in the one form the list hashes (src/shared/access-protocol.ts's normaliseToken). */
  function normaliseToken(typed) {
    var t = String(typed).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    if (t.length !== PROTOCOL.tokenLength) return null;
    for (var i = 0; i < t.length; i++) if (PROTOCOL.tokenAlphabet.indexOf(t.charAt(i)) < 0) return null;
    return t;
  }

  function formatToken(token) {
    return (token.match(/.{1,4}/g) || []).join('-');
  }

  /** A new token: 140 random bits as 28 of Crockford's base32 letters. */
  function makeToken(env) {
    var bytes = env.randomBytes(18);
    var bits = '';
    for (var i = 0; i < bytes.length; i++) bits += ('0000000' + (bytes[i] & 255).toString(2)).slice(-8);
    var out = '';
    for (var j = 0; j < PROTOCOL.tokenLength; j++)
      out += PROTOCOL.tokenAlphabet.charAt(parseInt(bits.slice(j * 5, j * 5 + 5), 2));
    return out;
  }

  /** What the Sheet keeps of a token: its SHA-256, never the token. */
  function tokenHash(env, normalised) {
    return env.sha256Hex('drashti-token\n' + normalised);
  }

  /** A computer's secret for one grant, worked out again at each call and never kept by the list. */
  function computerSecret(env, props, grantId, computerId) {
    return env.hmacHex(props.secretKey, 'drashti-computer-secret\n' + grantId + '\n' + computerId);
  }

  /** Characters that hide or reorder text, or end a line: never in a name the list shows or emails. */
  function hidden(c) {
    return (
      c === 0x200b ||
      c === 0x200e ||
      c === 0x200f ||
      (c >= 0x202a && c <= 0x202e) ||
      (c >= 0x2060 && c <= 0x2064) ||
      (c >= 0x2066 && c <= 0x206f) ||
      c === 0xfeff
    );
  }

  /** Letters as people see them, so a cut never splits one (Intl.Segmenter where there is one). */
  function letters(text) {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function')
      return Array.from(
        new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
        function (s) {
          return s.segment;
        },
      );
    return Array.from(text);
  }

  /**
   * Text a person typed, made safe to keep, show and email: one line, no hidden characters, nothing a
   * Sheet would read as a formula (=, +, - or @ first), at most `max` letters.
   */
  function cleanText(value, max) {
    var s = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) out += ' ';
      else if (!hidden(c)) out += s.charAt(i);
    }
    out = out
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[=+@'\s-]+/, '');
    if (out.length <= max) return out;
    var parts = letters(out);
    var cut = '';
    for (var j = 0; j < parts.length && cut.length + parts[j].length <= max; j++) cut += parts[j];
    return cut.trim();
  }

  function toMs(v) {
    if (v === null || v === undefined || v === '') return null;
    if (Object.prototype.toString.call(v) === '[object Date]') {
      var t = v.getTime();
      return isFinite(t) ? t : null;
    }
    if (typeof v === 'number') return isFinite(v) && v > 1e11 ? v : null;
    var parsed = Date.parse(String(v));
    return isFinite(parsed) ? parsed : null;
  }

  function toCount(v) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  function statusOf(person) {
    return String(person.status === null || person.status === undefined ? '' : person.status)
      .trim()
      .toLowerCase();
  }

  function platformName(platform) {
    return platform === 'darwin' ? 'Mac' : platform === 'win32' ? 'Windows' : platform || 'unknown';
  }

  function computerLine(c) {
    return c.name + ' (Drashti ' + c.version + ', ' + platformName(c.platform) + ')';
  }

  // ---- the cache: never needed, only quicker ----

  function cacheGet(env, key) {
    try {
      return env.cache.get(key);
    } catch (e) {
      return null;
    }
  }

  function cachePut(env, key, value, seconds) {
    try {
      env.cache.put(key, value, seconds);
    } catch (e) {
      // Quicker next time only.
    }
  }

  /** A key for a Gmail or a computer: short and the same length, whatever was typed. */
  function cacheKey(env, kind, id) {
    return kind + ':' + env.sha256Hex(String(id)).slice(0, 32);
  }

  /**
   * One more try in this window for `id`; false when it already had `max`. Counted in the cache, so only for
   * windows of an hour (Google keeps nothing in it past 6 hours; the day's requests are counted in the
   * script's settings: countRequest).
   */
  function allowed(env, kind, id, windowMs, max) {
    var key = cacheKey(env, kind, id) + ':' + Math.floor(env.now() / windowMs);
    var n = Number(cacheGet(env, key)) || 0;
    if (n >= max) return false;
    cachePut(env, key, String(n + 1), Math.min(Math.ceil(windowMs / 1000) + 60, 6 * 60 * 60));
    return true;
  }

  /**
   * The day's requests (a day by the list's clock, UTC), kept in the script's settings as REQUESTS_TODAY:
   * how many in all, and for each Gmail and computer (by a short hash). One request more, or false when one
   * of PROTOCOL.limits' day limits is reached; a request refused is never counted, so it stays a few KB
   * whoever sends what. Under the script's lock (read, then written).
   */
  var REQUESTS_TODAY = 'REQUESTS_TODAY';

  function countRequest(env, call) {
    var L = PROTOCOL.limits;
    var day = Math.floor(env.now() / DAY);
    var kept;
    try {
      kept = JSON.parse(env.properties.get(REQUESTS_TODAY) || 'null');
    } catch (e) {
      kept = null;
    }
    if (
      !isObject(kept) ||
      kept.d !== day ||
      !isObject(kept.g) ||
      !isObject(kept.c) ||
      typeof kept.n !== 'number'
    )
      kept = { d: day, n: 0, g: {}, c: {} };
    var g = env.sha256Hex('gmail:' + call.key).slice(0, 16);
    var c = env.sha256Hex('computer:' + call.computer.id).slice(0, 16);
    var forGmail = hasOwn(kept.g, g) ? Number(kept.g[g]) || 0 : 0;
    var forComputer = hasOwn(kept.c, c) ? Number(kept.c[c]) || 0 : 0;
    if (
      forGmail >= L.requestsPerGmailPerDay ||
      forComputer >= L.requestsPerComputerPerDay ||
      kept.n >= L.requestsPerDay
    )
      return false;
    kept.g[g] = forGmail + 1;
    kept.c[c] = forComputer + 1;
    kept.n += 1;
    try {
      env.properties.set(REQUESTS_TODAY, JSON.stringify(kept));
    } catch (e) {
      if (env.log)
        env.log('The day’s requests could not be counted: ' + String(e && e.message ? e.message : e));
    }
    return true;
  }

  /**
   * What the list read from its Sheet, kept up to PROTOCOL.limits.cacheMs for the checks (a Sheet read is
   * the slow part of a check). Every write the list makes changes `gen`, so a read made before it is never
   * used after it; an edit typed in the Sheet counts once the read is that old.
   */
  var PART = 90000;

  function putBig(env, name, value, seconds) {
    try {
      var text = asciiOnly(JSON.stringify(value));
      var id = hex(env.randomBytes(6));
      var n = Math.max(1, Math.ceil(text.length / PART));
      var values = {};
      for (var i = 0; i < n; i++) values[name + ':' + id + ':' + i] = text.slice(i * PART, (i + 1) * PART);
      values[name] = JSON.stringify({ id: id, n: n });
      env.cache.putAll(values, seconds);
    } catch (e) {
      // Read from the Sheet again next time.
    }
  }

  function getBig(env, name) {
    try {
      var head = env.cache.get(name);
      if (!head) return null;
      var h = JSON.parse(head);
      var keys = [];
      for (var i = 0; i < h.n; i++) keys.push(name + ':' + h.id + ':' + i);
      var got = env.cache.getAll(keys) || {};
      var text = '';
      for (var j = 0; j < keys.length; j++) {
        if (typeof got[keys[j]] !== 'string') return null;
        text += got[keys[j]];
      }
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  function generation(env) {
    var gen = cacheGet(env, 'gen');
    if (!gen) {
      gen = hex(env.randomBytes(8));
      cachePut(env, 'gen', gen, 6 * 60 * 60);
    }
    return gen;
  }

  function newGeneration(env) {
    cachePut(env, 'gen', hex(env.randomBytes(8)), 6 * 60 * 60);
  }

  // ---- how long access lasts ----

  var UNLIMITED = 'unlimited';
  /** How the Sheet says a Gmail's access has no end. */
  var UNLIMITED_WORD = 'Unlimited';
  /** An end typed in the Sheet that the list cannot read: it stops that Gmail's computers until put right. */
  var UNREADABLE = -1;

  /** A length the list gives: 'unlimited', or a whole number of days from 1 to PROTOCOL.lengths.maxDays. */
  function lengthOk(length) {
    return (
      length === UNLIMITED ||
      (typeof length === 'number' &&
        isFinite(length) &&
        length === Math.floor(length) &&
        length >= 1 &&
        length <= PROTOCOL.lengths.maxDays)
    );
  }

  /** When access given now for `length` ends: null for none. */
  function endsFor(now, length) {
    return length === UNLIMITED ? null : now + length * DAY;
  }

  /** An Access ends cell: a time; null for none (empty, or Unlimited); UNREADABLE for anything else typed. */
  function endsFromCell(v) {
    if (v === null || v === undefined) return null;
    if (Object.prototype.toString.call(v) === '[object Date]') {
      var t = v.getTime();
      return isFinite(t) && t > 0 ? t : UNREADABLE;
    }
    var s = String(v).trim().toLowerCase();
    return s === '' || s === UNLIMITED ? null : UNREADABLE;
  }

  /** A Length cell: 'unlimited', days, or null (none given). */
  function lengthFromCell(v) {
    var s = String(v === null || v === undefined ? '' : v)
      .trim()
      .toLowerCase();
    if (s === UNLIMITED) return UNLIMITED;
    var n = s === '' ? NaN : Number(s);
    return lengthOk(n) ? n : null;
  }

  // ---- the Sheet ----

  function columnOf(tab, field) {
    var columns = TABLES[tab];
    for (var i = 0; i < columns.length; i++) if (columns[i].field === field) return columns[i];
    throw new Error('No column ' + field + ' in ' + tab);
  }

  function fromCell(v, c) {
    if (c.ends) return endsFromCell(v);
    if (c.length) return lengthFromCell(v);
    if (c.date) return toMs(v);
    if (c.number) return toCount(v);
    return v === null || v === undefined ? '' : String(v).trim();
  }

  function toCell(v, c) {
    if (c.ends) return typeof v === 'number' && v > 0 ? new Date(v) : v === null ? UNLIMITED_WORD : '';
    if (c.length) return v === UNLIMITED || typeof v === 'number' ? v : '';
    if (c.date) return v ? new Date(v) : '';
    if (c.number) return toCount(v);
    // Every text the list writes was cleaned when it came in; this keeps a formula out all the same.
    return String(v === null || v === undefined ? '' : v).replace(/^[=+@-]+/, '');
  }

  function headersOf(headerRow) {
    return (headerRow || []).map(function (h) {
      return String(h === null || h === undefined ? '' : h)
        .trim()
        .toLowerCase();
    });
  }

  /**
   * Where each of a tab's columns is, by its header (the owner may move or add columns). A column the list adds
   * itself (`added`) that is not there yet goes into `missing` when it is given; any other is refused.
   */
  function columnsFrom(tab, headerRow, missing) {
    var header = headersOf(headerRow);
    var cols = {};
    TABLES[tab].forEach(function (c) {
      var i = header.indexOf(c.header.toLowerCase());
      if (i < 0 && c.added && missing) {
        missing.push(c);
        return;
      }
      if (i < 0)
        throw refusal(
          'server',
          'The "' + tab + '" tab has no "' + c.header + '" column: open Drashti › Set up… in the Sheet.',
        );
      cols[c.field] = i + 1;
    });
    return cols;
  }

  /**
   * Columns that came after the owner's Sheet was set up, added by the list itself after its last column, under
   * the lock (a column another call added meanwhile is not added twice); Access ends written Unlimited for each
   * Gmail approved, as each was let in before lengths came.
   */
  function addColumns(env, tab, missing) {
    var add = function () {
      var header = headersOf(env.sheet.row(tab, 1));
      missing.forEach(function (c) {
        if (header.indexOf(c.header.toLowerCase()) >= 0) return;
        var col = env.sheet.addColumn(tab, c.header, {
          hidden: Boolean(c.hidden),
          date: Boolean(c.date || c.ends),
        });
        header[col - 1] = c.header.toLowerCase();
        if (c.field !== 'endsAt') return;
        var status = header.indexOf(columnOf(tab, 'status').header.toLowerCase()) + 1;
        var statuses = status > 0 ? env.sheet.column(tab, status) || [] : [];
        for (var r = 1; r < statuses.length; r++)
          if (statusOf({ status: statuses[r] }) === 'approved')
            env.sheet.write(tab, r + 1, col, UNLIMITED_WORD);
      });
    };
    if (lockDepth > 0) add();
    else withLock(env, add);
  }

  function readTable(env, tab) {
    var cells = env.sheet.read(tab);
    if (!cells || cells.length === 0)
      throw refusal('server', 'The Sheet has no "' + tab + '" tab: open Drashti › Set up… in the Sheet.');
    var missing = [];
    var cols = columnsFrom(tab, cells[0], missing);
    if (missing.length > 0) {
      addColumns(env, tab, missing);
      cells = env.sheet.read(tab);
      cols = columnsFrom(tab, cells[0]);
    }
    var rows = [];
    for (var r = 1; r < cells.length; r++) {
      var line = cells[r] || [];
      var rec = { row: r + 1 };
      TABLES[tab].forEach(function (c) {
        rec[c.field] = fromCell(line[cols[c.field] - 1], c);
      });
      rows.push(rec);
    }
    return { cols: cols, rows: rows };
  }

  function index(data) {
    data.byKey = Object.create(null);
    data.byGrant = Object.create(null);
    data.people.forEach(function (p) {
      p.key = gmailKey(p.gmail);
      // One row per Gmail: a second row for the same Gmail is never read (the first one counts).
      if (p.key && !data.byKey[p.key]) data.byKey[p.key] = p;
    });
    data.grants.forEach(function (g) {
      g.key = gmailKey(g.gmail);
      if (!data.byGrant[g.grantId]) data.byGrant[g.grantId] = g;
    });
    return data;
  }

  /** Both tabs, read now. */
  function load(env) {
    var p = readTable(env, PEOPLE);
    var g = readTable(env, COMPUTERS);
    return index({
      people: p.rows.filter(function (r) {
        return gmailKey(r.gmail) !== '';
      }),
      grants: g.rows.filter(function (r) {
        return /^[0-9a-f]{32}$/.test(r.grantId);
      }),
      pcols: p.cols,
      gcols: g.cols,
    });
  }

  /** Both tabs as read at most PROTOCOL.limits.cacheMs ago, and never before the list's last write. */
  function snapshot(env) {
    var gen = generation(env);
    var now = env.now();
    var kept = getBig(env, 'snap');
    if (kept && kept.gen === gen && kept.at <= now && now - kept.at < PROTOCOL.limits.cacheMs)
      return index(kept);
    var data = load(env);
    putBig(
      env,
      'snap',
      { gen: gen, at: now, people: data.people, grants: data.grants, pcols: data.pcols, gcols: data.gcols },
      Math.ceil(PROTOCOL.limits.cacheMs / 1000),
    );
    return data;
  }

  /** The row a record is on now (someone may have sorted the Sheet), or 0 when it is gone. */
  function locate(env, tab, cols, rec) {
    var people = tab === PEOPLE;
    var col = people ? cols.gmail : cols.grantId;
    var same = function (v) {
      return people
        ? gmailKey(v) === rec.key
        : String(v === null || v === undefined ? '' : v).trim() === rec.grantId;
    };
    if (rec.row > 1 && same((env.sheet.row(tab, rec.row) || [])[col - 1])) return rec.row;
    var values = env.sheet.column(tab, col) || [];
    for (var i = 1; i < values.length; i++) if (same(values[i])) return i + 1;
    return 0;
  }

  /**
   * Write only the cells that change, so nothing written at the same moment by another call is undone; the
   * columns found again from the header first, and the row by its Gmail or grant (the owner may have moved
   * either since the Sheet was read).
   */
  function write(env, tab, cols, rec, changes) {
    var found = columnsFrom(tab, env.sheet.row(tab, 1));
    Object.keys(found).forEach(function (f) {
      cols[f] = found[f];
    });
    var row = locate(env, tab, cols, rec);
    if (!row) return false;
    rec.row = row;
    Object.keys(changes).forEach(function (field) {
      env.sheet.write(tab, row, cols[field], toCell(changes[field], columnOf(tab, field)));
      rec[field] = changes[field];
    });
    return true;
  }

  function append(env, tab, cols, fields) {
    var width = 0;
    Object.keys(cols).forEach(function (f) {
      width = Math.max(width, cols[f]);
    });
    var values = [];
    for (var i = 0; i < width; i++) values.push('');
    var rec = {};
    TABLES[tab].forEach(function (c) {
      var v = hasOwn(fields, c.field) ? fields[c.field] : c.date ? null : c.number ? 0 : '';
      rec[c.field] = v;
      values[cols[c.field] - 1] = toCell(v, c);
    });
    rec.row = env.sheet.append(tab, values);
    rec.key = gmailKey(rec.gmail);
    return rec;
  }

  function writePerson(env, data, person, changes) {
    return write(env, PEOPLE, data.pcols, person, changes);
  }

  function writeGrant(env, data, grant, changes) {
    return write(env, COMPUTERS, data.gcols, grant, changes);
  }

  function addPerson(env, data, fields) {
    var p = append(env, PEOPLE, data.pcols, fields);
    data.people.push(p);
    if (!data.byKey[p.key]) data.byKey[p.key] = p;
    return p;
  }

  function addGrant(env, data, fields) {
    var g = append(env, COMPUTERS, data.gcols, fields);
    data.grants.push(g);
    data.byGrant[g.grantId] = g;
    return g;
  }

  function grantsOf(data, key) {
    return data.grants.filter(function (g) {
      return g.key === key;
    });
  }

  /** A grant that lets a computer in: its token used, never ended. */
  function live(g) {
    return Boolean(g.usedAt) && !g.endedAt;
  }

  /** A token sent and not used, ended or run out. */
  function waiting(env, g) {
    return !g.usedAt && !g.endedAt && Boolean(g.sentAt) && env.now() <= g.sentAt + PROTOCOL.tokenMs;
  }

  /** The Gmail's row's activity and computers, summed from its computers' rows (shown in the Sheet). */
  function totals(data, key) {
    var t = {
      computers: '',
      version: '',
      lastSeen: null,
      minutes: 0,
      shows: 0,
      streams: 0,
      recordings: 0,
      imports: 0,
    };
    var names = [];
    grantsOf(data, key).forEach(function (g) {
      ACTIVITY.forEach(function (a) {
        t[a] += toCount(g[a]);
      });
      if (g.lastSeen && (!t.lastSeen || g.lastSeen > t.lastSeen)) {
        t.lastSeen = g.lastSeen;
        t.version = g.version;
      }
      if (live(g)) names.push(g.computerName || 'a computer');
    });
    t.computers = names.join(', ');
    return t;
  }

  function writeTotals(env, data, key) {
    var person = data.byKey[key];
    if (person) writePerson(env, data, person, totals(data, key));
  }

  /** How many withLock calls are running now: inside one, the lock is never taken again. */
  var lockDepth = 0;

  /** fn under the script's lock; then the Sheet written, and every read kept from before thrown away. */
  function withLock(env, fn) {
    var result;
    try {
      result = env.lock(function () {
        lockDepth++;
        try {
          return fn();
        } finally {
          lockDepth--;
          env.flush();
          newGeneration(env);
        }
      });
    } catch (e) {
      if (isRefusal(e)) throw e;
      if (e && e.message === 'busy') throw refusal('busy');
      throw e;
    }
    return result;
  }

  function needProps(env) {
    var props = env.props();
    if (
      !props ||
      !props.approverEmail ||
      !gmailShaped(props.approverEmail) ||
      !props.webAppUrl ||
      !/^[0-9a-f]{64}$/.test(props.linkKey || '') ||
      !/^[0-9a-f]{64}$/.test(props.secretKey || '') ||
      !props.hasSigningKey
    )
      throw refusal('not-set-up');
    return props;
  }

  function ownerKey(props) {
    return gmailKey(props.approverEmail);
  }

  // ---- what a person changing a status in the Sheet means ----

  /** A status typed in the Sheet, not yet seen by the list. */
  function changedByHand(person) {
    return statusOf(person) !== String(person.statusSeen || '').toLowerCase();
  }

  /** End every grant of a Gmail still open (its computers in, and a token not used yet). */
  function endGrants(env, data, key, why) {
    var now = env.now();
    grantsOf(data, key).forEach(function (g) {
      if (!g.endedAt) writeGrant(env, data, g, { endedAt: now, endedWhy: why });
    });
    writeTotals(env, data, key);
  }

  /**
   * Take in a status typed in the Sheet: its date written, and for revoked or rejected every computer of
   * that Gmail ended (so typing approved again later lets none of them back in: Give access again does).
   * Typing approved sends no token. Called under the lock with `data` read under it.
   */
  function takeInHandEdit(env, data, person) {
    var s = statusOf(person);
    var changes = { statusSeen: s };
    var dateField = {
      approved: 'approvedAt',
      rejected: 'rejectedAt',
      revoked: 'revokedAt',
      requested: 'requestedAt',
    }[s];
    if (dateField && (person.statusSeen || !person[dateField])) changes[dateField] = env.now();
    writePerson(env, data, person, changes);
    if (s === 'revoked' || s === 'rejected') endGrants(env, data, person.key, s);
  }

  function takeInHandEdits(env, keys) {
    withLock(env, function () {
      var data = load(env);
      keys.forEach(function (key) {
        var p = data.byKey[key];
        if (p && changedByHand(p)) takeInHandEdit(env, data, p);
      });
    });
  }

  // ---- emails ----

  function send(env, mail) {
    try {
      env.mail.send(mail);
    } catch (e) {
      if (env.log) env.log('Mail to ' + mail.to + ' failed: ' + String(e && e.message ? e.message : e));
      throw refusal('mail-failed');
    }
  }

  function remaining(env) {
    try {
      return Number(env.mail.remaining()) || 0;
    } catch (e) {
      return 0;
    }
  }

  function link(env, props, action, requestId, expires) {
    var sig = env.hmacHex(props.linkKey, 'drashti-link\n' + action + '\n' + requestId + '\n' + expires);
    return props.webAppUrl + '?a=' + action + '&r=' + requestId + '&x=' + expires + '&s=' + sig;
  }

  function requestMail(env, props, person, added) {
    var expires = person.requestAt + PROTOCOL.linkMs;
    var who = person.name ? person.name + ' (' + person.gmail + ')' : person.gmail;
    var lines = added
      ? ['You added ' + person.gmail + ' to Drashti’s access list.', '']
      : [
          who + ' asks to use Drashti.',
          '',
          'Gmail: ' + person.gmail,
          'Name they typed: ' + (person.name || '(none)'),
          'Computer: ' + (person.requestComputer || '(not given)'),
          'Asked: ' + env.formatTime(person.requestAt),
          '',
        ];
    lines.push(
      'Approve: ' + link(env, props, 'approve', person.requestId, expires),
      '',
      'Reject: ' + link(env, props, 'reject', person.requestId, expires),
      '',
      'Each link opens a page with one button; nothing changes until you press it. The links work once, and run out on ' +
        env.formatTime(expires) +
        '.',
      'On the Approve page you choose how long access lasts: Unlimited (until you revoke it) unless you choose a length.',
      'You can also answer in Drashti on your own computer: View › Access List.',
    );
    return {
      to: props.approverEmail,
      subject: 'Drashti: ' + person.gmail + (added ? ' added' : ' asks for access'),
      body: lines.join('\n'),
    };
  }

  function tokenMail(env, person, token, runsOut, endsAt) {
    return {
      to: person.gmail,
      subject: 'Your Drashti token',
      body: [
        'Your Gmail ' +
          person.gmail +
          ' may now use Drashti' +
          (endsAt === null ? '.' : ', until ' + env.formatTime(endsAt) + '.'),
        '',
        'Your one-time token:',
        '',
        '    ' + formatToken(token),
        '',
        'In Drashti, choose I Have a Token, then type your Gmail and this token. It lets one computer in, works once, and runs out on ' +
          env.formatTime(runsOut) +
          ' if it is not used.',
        'Each computer needs its own token: for another computer, ask the person who approved you to give access again.',
        'Keep it to yourself: with your Gmail, it lets a computer in.',
      ].join('\n'),
    };
  }

  function rejectMail(person) {
    return {
      to: person.gmail,
      subject: 'Your Drashti request',
      body: 'Your request to use Drashti with ' + person.gmail + ' was not approved.',
    };
  }

  /**
   * A new grant for a Gmail: a new token emailed to it, and its row approved for `length` from now (the clock
   * starts at the approval). The newest token is the only one that works: one sent before and not used yet ends.
   * Computers already in stay in, for the new length. Under the lock.
   */
  function grant(env, props, data, person, length) {
    if (remaining(env) < 1) throw refusal('mail-limit');
    var now = env.now();
    var endsAt = endsFor(now, length);
    var token = makeToken(env);
    // The email first: if it cannot go, nothing changes (the token sent before still works).
    send(env, tokenMail(env, person, token, now + PROTOCOL.tokenMs, endsAt));
    grantsOf(data, person.key).forEach(function (g) {
      if (!g.usedAt && !g.endedAt) writeGrant(env, data, g, { endedAt: now, endedWhy: 'replaced' });
    });
    addGrant(env, data, {
      gmail: person.gmail,
      grantId: hex(env.randomBytes(16)),
      tokenHash: tokenHash(env, token),
      sentAt: now,
    });
    var changes = { status: 'approved', statusSeen: 'approved', endsAt: endsAt, length: length };
    if (statusOf(person) !== 'approved' || !person.approvedAt) changes.approvedAt = now;
    if (person.requestId && !person.answered) changes.answered = 'approved';
    writePerson(env, data, person, changes);
    return { runsOut: now + PROTOCOL.tokenMs, endsAt: endsAt };
  }

  /** A Gmail approved now ends `length` from now: its computers in (or stopped by an end) keep their grants. */
  function setLength(env, data, person, length) {
    var endsAt = endsFor(env.now(), length);
    writePerson(env, data, person, { endsAt: endsAt, length: length });
    return endsAt;
  }

  /**
   * Whether an approved Gmail's access has ended by the list's clock, or its end typed in the Sheet cannot be read
   * (which stops it until put right). The owner's own row never ends, whatever is typed on it.
   */
  function ended(env, props, person) {
    if (person.key === ownerKey(props)) return false;
    var e = person.endsAt;
    return e === UNREADABLE || (typeof e === 'number' && e > 0 && e <= env.now());
  }

  /** When a Gmail's access ends, by the list's clock: null for none (the owner's, Unlimited, or not readable). */
  function endsOf(props, person) {
    var e = person.endsAt;
    return person.key !== ownerKey(props) && typeof e === 'number' && e > 0 ? e : null;
  }

  /**
   * A row asked (or asked again) for: requested, with a new request id, so links sent before are replaced. Its
   * Length is the one the owner chose adding it (for the approval), or none (Unlimited is offered first).
   */
  function newRequest(env, data, person, fields) {
    var now = env.now();
    var changes = {
      status: 'requested',
      statusSeen: 'requested',
      requestedAt: now,
      requestId: hex(env.randomBytes(16)),
      requestFrom: fields.requestFrom,
      requestComputer: fields.requestComputer,
      requestAt: now,
      answered: '',
      length: fields.length || null,
    };
    if (fields.name) changes.name = fields.name;
    if (fields.note) changes.note = fields.note;
    if (person) {
      writePerson(env, data, person, changes);
      return person;
    }
    changes.gmail = fields.gmail;
    return addPerson(env, data, changes);
  }

  // ---- reading a call ----

  var HEX32 = /^[0-9a-f]{32}$/;
  var HEX64 = /^[0-9a-f]{64}$/;
  var VERSION_SHAPE = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/;

  function readCall(text, seen) {
    if (typeof text !== 'string' || text.length === 0 || text.length > 16384) throw refusal('bad-request');
    var raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw refusal('bad-request');
    }
    if (!isObject(raw)) throw refusal('bad-request');
    // What the answer echoes, whatever else is wrong (Drashti believes only an answer echoing its own).
    if (typeof raw.op === 'string' && raw.op.length <= 20) seen.op = raw.op;
    if (typeof raw.nonce === 'string' && HEX32.test(raw.nonce)) seen.nonce = raw.nonce;
    if (isObject(raw.computer) && typeof raw.computer.id === 'string' && HEX64.test(raw.computer.id))
      seen.computerId = raw.computer.id;
    if (raw.v !== PROTOCOL.version)
      throw refusal('bad-request', 'This Drashti speaks another version of the list’s language: update it.');
    var op = raw.op;
    if (PROTOCOL.publicOps.indexOf(op) < 0 && PROTOCOL.ownerOps.indexOf(op) < 0) throw refusal('bad-request');
    if (!seen.nonce || !seen.computerId) throw refusal('bad-request');
    var c = raw.computer;
    var call = {
      raw: raw,
      op: op,
      nonce: raw.nonce,
      computer: {
        id: c.id,
        name: cleanText(c.name, 60) || 'a computer',
        version: typeof c.version === 'string' && VERSION_SHAPE.test(c.version) ? c.version : 'unknown',
        platform:
          typeof c.platform === 'string' && /^[a-z0-9]{1,12}$/.test(c.platform) ? c.platform : 'other',
      },
    };
    if (typeof raw.gmail !== 'string' || !gmailShaped(raw.gmail)) throw refusal('bad-gmail');
    call.gmail = raw.gmail.trim();
    call.key = gmailKey(call.gmail);
    if (op === 'request') call.name = cleanText(raw.name, 60);
    if (op === 'redeem') {
      if (typeof raw.token !== 'string' || raw.token.length > 100) throw refusal('bad-request');
      call.token = raw.token;
    }
    if (op === 'check' || PROTOCOL.ownerOps.indexOf(op) >= 0) {
      if (typeof raw.grantId !== 'string' || !HEX32.test(raw.grantId)) throw refusal('bad-request');
      if (typeof raw.mac !== 'string' || !HEX64.test(raw.mac)) throw refusal('bad-request');
      if (
        typeof raw.at !== 'number' ||
        !isFinite(raw.at) ||
        raw.at !== Math.floor(raw.at) ||
        raw.at < 0 ||
        raw.at > 1e15
      )
        throw refusal('bad-request');
      call.grantId = raw.grantId;
      call.mac = raw.mac;
      call.at = raw.at;
    }
    if (op === 'check') {
      var a = isObject(raw.activity) ? raw.activity : {};
      call.activity = {};
      ACTIVITY.forEach(function (k) {
        var n = a[k] === undefined ? 0 : a[k];
        if (typeof n !== 'number' || !isFinite(n) || n < 0 || n > 1e9 || n !== Math.floor(n))
          throw refusal('bad-request');
        call.activity[k] = n;
      });
    }
    if (PROTOCOL.ownerOps.indexOf(op) >= 0 && op !== 'list') {
      if (typeof raw.target !== 'string' || !gmailShaped(raw.target)) throw refusal('bad-gmail');
      call.target = raw.target.trim();
      call.targetKey = gmailKey(call.target);
      if (op === 'add') call.name = cleanText(raw.name, 60);
      if (op === 'add' || op === 'note') call.note = cleanText(raw.note, 500);
      if (op === 'note' && typeof raw.note !== 'string') throw refusal('bad-request');
    }
    if (op === 'add' || op === 'approve' || op === 'regrant' || op === 'length') {
      // How long access lasts: always said for a change of length; Unlimited when not said for the others.
      if (raw.length === undefined && op === 'length') throw refusal('bad-request');
      call.length = raw.length === undefined ? UNLIMITED : raw.length;
      if (!lengthOk(call.length)) throw refusal('bad-length');
    }
    return call;
  }

  /**
   * The grant a signed call (a check, or the owner's) comes with, when its mac is right: the grant is the
   * call's, made for this computer and this Gmail, and the call was signed with its secret. Null otherwise.
   */
  function signedGrant(env, props, data, call) {
    var g = data.byGrant[call.grantId];
    if (!g || !g.usedAt || g.computerId !== call.computer.id || g.key !== call.key) return null;
    var raw = Object.create(null);
    Object.keys(call.raw).forEach(function (k) {
      if (k !== 'mac') raw[k] = call.raw[k];
    });
    var secret = computerSecret(env, props, g.grantId, g.computerId);
    return sameText(env.hmacHex(secret, PROTOCOL.macPrefix + canonicalJson(raw)), call.mac) ? g : null;
  }

  // ---- the calls ----

  function request(env, props, call) {
    // The owner's row is never asked for (nor made "requested" again, whatever anyone sends): the owner's
    // way in is Let me in, from the Sheet's own menu.
    if (call.key === ownerKey(props)) throw refusal('owner-row');
    var person = withLock(env, function () {
      if (!countRequest(env, call)) throw refusal('too-many');
      var data = load(env);
      var p = data.byKey[call.key];
      if (p && changedByHand(p)) takeInHandEdit(env, data, p);
      if (p && statusOf(p) === 'approved' && !ended(env, props, p)) {
        var mine = grantsOf(data, p.key);
        // Approved, and a computer in or a token waiting: the person uses it, or the owner gives access
        // again. Approved with neither (its token ran out unused), or its length ended: asked for again like
        // any other.
        if (
          mine.some(live) ||
          mine.some(function (g) {
            return waiting(env, g);
          })
        )
          throw refusal('already-approved');
      }
      return newRequest(env, data, p, {
        gmail: call.gmail,
        name: call.name,
        requestFrom: call.computer.id,
        requestComputer: computerLine(call.computer),
      });
    });
    var mailed = false;
    if (remaining(env) >= 1)
      try {
        send(env, requestMail(env, props, person, false));
        mailed = true;
      } catch (e) {
        mailed = false;
      }
    return { ok: true, status: 'requested', mailed: mailed };
  }

  function status(env, props, call) {
    var data = snapshot(env);
    var p = data.byKey[call.key];
    // Answered only to the computer that asked.
    if (!p || p.requestFrom !== call.computer.id) return { ok: true, status: 'unknown', tokenWaiting: false };
    if (changedByHand(p)) {
      takeInHandEdits(env, [p.key]);
      data = load(env);
      p = data.byKey[call.key];
      if (!p) return { ok: true, status: 'unknown', tokenWaiting: false };
    }
    var s = statusOf(p);
    return {
      ok: true,
      status: PROTOCOL.requestStatuses.indexOf(s) >= 0 ? s : 'unknown',
      tokenWaiting:
        s === 'approved' &&
        grantsOf(data, p.key).some(function (g) {
          return waiting(env, g);
        }),
    };
  }

  function redeem(env, props, call) {
    var L = PROTOCOL.limits;
    if (
      !allowed(env, 'rd-gmail', call.key, HOUR, L.redeemsPerGmailPerHour) ||
      !allowed(env, 'rd-computer', call.computer.id, HOUR, L.redeemsPerComputerPerHour)
    )
      throw refusal('too-many');
    var normalised = normaliseToken(call.token);
    var hash = normalised ? tokenHash(env, normalised) : '';
    return withLock(env, function () {
      var data = load(env);
      var p = data.byKey[call.key];
      if (p && changedByHand(p)) takeInHandEdit(env, data, p);
      // Whatever is wrong, the same answer: the token, the Gmail, the row's status, used, ended, run out.
      if (!p || !normalised || statusOf(p) !== 'approved') throw refusal('bad-token');
      var g = null;
      grantsOf(data, p.key).forEach(function (x) {
        if (sameText(x.tokenHash, hash)) g = x;
      });
      if (!g || !waiting(env, g)) throw refusal('bad-token');
      var now = env.now();
      writeGrant(env, data, g, {
        usedAt: now,
        computerId: call.computer.id,
        computerName: call.computer.name,
        version: call.computer.version,
        platform: call.computer.platform,
        lastSeen: now,
      });
      writeTotals(env, data, p.key);
      return {
        ok: true,
        grantId: g.grantId,
        secret: computerSecret(env, props, g.grantId, call.computer.id),
        owner: p.key === ownerKey(props),
      };
    });
  }

  function checkStatus(env, props, person, g) {
    if (!person) return 'unknown';
    if (g.endedAt)
      return g.endedWhy === 'revoked' ? 'revoked' : g.endedWhy === 'rejected' ? 'rejected' : 'unknown';
    var s = statusOf(person);
    // Its length ended (by the list's clock, never the computer's): stopped as a revoke stops it, but nothing is
    // ended, so a new length lets the same computers back in.
    if (s === 'approved') return ended(env, props, person) ? 'expired' : 'in';
    return s === 'revoked' ? 'revoked' : s === 'rejected' ? 'rejected' : 'unknown';
  }

  function check(env, props, call) {
    var now = env.now();
    var data = snapshot(env);
    var g = signedGrant(env, props, data, call);
    if (!g) return { ok: true, status: 'unknown', owner: false, recorded: false, endsAt: null };
    // At most one check a computer every PROTOCOL.limits.checkGapMs counts (is recorded); one sooner (Drashti
    // quit and started again at once, say) is answered as any other. Only signed ones are counted, so nobody
    // else can use up a computer's checks.
    var stateKey = cacheKey(env, 'computer', call.computer.id);
    var state;
    try {
      state = JSON.parse(cacheGet(env, stateKey) || '{}') || {};
    } catch (e) {
      state = {};
    }
    var counted = !(
      state.lastCheck &&
      state.lastCheck <= now &&
      now - state.lastCheck < PROTOCOL.limits.checkGapMs
    );
    var p = data.byKey[g.key];
    if (p && changedByHand(p)) {
      takeInHandEdits(env, [p.key]);
      data = load(env);
      p = data.byKey[g.key];
      g = data.byGrant[g.grantId] || g;
    }
    var s = checkStatus(env, props, p, g);
    var recorded = false;
    var lastRecord = state.lastRecord || g.lastSeen || 0;
    if (
      counted &&
      s === 'in' &&
      (lastRecord > now || now - lastRecord >= PROTOCOL.limits.recordGapMs) &&
      call.at > g.lastAt
    ) {
      // Written without the lock: only this computer's own cells (and its Gmail's totals), which no other
      // call writes but a revoke's end, kept apart.
      var changes = {
        lastSeen: now,
        version: call.computer.version,
        computerName: call.computer.name,
        platform: call.computer.platform,
        lastAt: call.at,
      };
      ACTIVITY.forEach(function (a) {
        changes[a] = call.activity[a];
      });
      if (writeGrant(env, data, g, changes)) {
        writeTotals(env, data, g.key);
        recorded = true;
      }
    }
    if (counted)
      cachePut(
        env,
        stateKey,
        JSON.stringify({ lastCheck: now, lastRecord: recorded ? now : state.lastRecord || 0 }),
        600,
      );
    return {
      ok: true,
      status: s,
      owner: s === 'in' && g.key === ownerKey(props),
      recorded: recorded,
      // Drashti's bar counts down to this from the answer's serverTime: the list's clock, never the computer's.
      endsAt: p && (s === 'in' || s === 'expired') ? endsOf(props, p) : null,
    };
  }

  function personAnswer(env, props, data, p) {
    var mine = grantsOf(data, p.key);
    var t = totals(data, p.key);
    var token = null;
    mine.forEach(function (g) {
      if (waiting(env, g)) token = { sentAt: g.sentAt, runsOut: g.sentAt + PROTOCOL.tokenMs };
    });
    return {
      gmail: p.gmail,
      name: p.name,
      status: statusOf(p),
      owner: p.key === ownerKey(props),
      requestedAt: p.requestedAt,
      approvedAt: p.approvedAt,
      rejectedAt: p.rejectedAt,
      revokedAt: p.revokedAt,
      lastSeen: t.lastSeen,
      version: t.version,
      minutes: t.minutes,
      shows: t.shows,
      streams: t.streams,
      recordings: t.recordings,
      imports: t.imports,
      note: p.note,
      // How long access lasts and when it ends, as the list's clock has it (the owner's own: always Unlimited).
      length: p.key === ownerKey(props) ? UNLIMITED : p.length,
      endsAt: endsOf(props, p),
      ended: statusOf(p) === 'approved' && ended(env, props, p),
      endsUnreadable: p.key !== ownerKey(props) && p.endsAt === UNREADABLE,
      computers: mine
        .filter(function (g) {
          return Boolean(g.usedAt);
        })
        .map(function (g) {
          return {
            name: g.computerName,
            version: g.version,
            platform: g.platform,
            lastSeen: g.lastSeen,
            usedAt: g.usedAt,
            ended: Boolean(g.endedAt),
            endedWhy: g.endedWhy,
          };
        }),
      token: token,
      request: p.requestId && !p.answered ? { computer: p.requestComputer, at: p.requestAt } : null,
    };
  }

  /** The owner's calls: signed as a check is, from a computer let in with the approver's own Gmail. */
  function owner(env, props, call) {
    var verify = function (data) {
      var g = signedGrant(env, props, data, call);
      var me = g && data.byKey[g.key];
      if (!g || !live(g) || !me || statusOf(me) !== 'approved' || g.key !== ownerKey(props))
        throw refusal('not-owner');
    };
    if (call.op === 'list') {
      var data = load(env);
      verify(data);
      var edited = data.people
        .filter(function (p) {
          return data.byKey[p.key] === p && changedByHand(p);
        })
        .map(function (p) {
          return p.key;
        });
      if (edited.length > 0) {
        takeInHandEdits(env, edited);
        data = load(env);
      }
      return {
        ok: true,
        people: data.people
          .filter(function (p) {
            return data.byKey[p.key] === p;
          })
          .map(function (p) {
            return personAnswer(env, props, data, p);
          }),
      };
    }
    return withLock(env, function () {
      var data = load(env);
      verify(data);
      var p = data.byKey[call.targetKey];
      if (p && changedByHand(p)) takeInHandEdit(env, data, p);
      var isOwnerRow = call.targetKey === ownerKey(props);
      // The owner's own row is always Unlimited: a length is never given to it (as it is never revoked).
      if (isOwnerRow && (call.op === 'length' || (call.length !== undefined && call.length !== UNLIMITED)))
        throw refusal('owner-row');
      switch (call.op) {
        case 'add': {
          if (p && statusOf(p) === 'approved') throw refusal('already-approved');
          var added = newRequest(env, data, p, {
            gmail: call.target,
            name: call.name,
            note: call.note,
            requestFrom: '',
            requestComputer: 'added by the owner',
            length: call.length,
          });
          var mailed = false;
          if (remaining(env) >= 1)
            try {
              send(env, requestMail(env, props, added, true));
              mailed = true;
            } catch (e) {
              mailed = false;
            }
          return { ok: true, status: 'requested', mailed: mailed };
        }
        case 'note':
          if (!p) throw refusal('not-found');
          writePerson(env, data, p, { note: call.note });
          return { ok: true };
        case 'approve':
        case 'regrant': {
          if (!p) throw refusal('not-found');
          if (call.op === 'approve' && statusOf(p) === 'approved') throw refusal('already-approved');
          var sent = grant(env, props, data, p, call.length);
          return { ok: true, status: 'approved', runsOut: sent.runsOut, endsAt: sent.endsAt };
        }
        case 'length': {
          // A new length for a Gmail approved, counted from now: its computers stopped by an end come back.
          if (!p) throw refusal('not-found');
          if (statusOf(p) !== 'approved') throw refusal('wrong-status');
          return { ok: true, status: 'approved', endsAt: setLength(env, data, p, call.length) };
        }
        case 'reject': {
          if (!p) throw refusal('not-found');
          if (isOwnerRow) throw refusal('owner-row');
          if (statusOf(p) !== 'requested') throw refusal('wrong-status');
          return reject(env, data, p);
        }
        default: {
          // revoke
          if (!p) throw refusal('not-found');
          if (isOwnerRow) throw refusal('owner-row');
          if (statusOf(p) !== 'approved') throw refusal('wrong-status');
          writePerson(env, data, p, { status: 'revoked', statusSeen: 'revoked', revokedAt: env.now() });
          endGrants(env, data, p.key, 'revoked');
          return { ok: true, status: 'revoked' };
        }
      }
    });
  }

  function reject(env, data, p) {
    var changes = { status: 'rejected', statusSeen: 'rejected', rejectedAt: env.now() };
    if (p.requestId && !p.answered) changes.answered = 'rejected';
    writePerson(env, data, p, changes);
    endGrants(env, data, p.key, 'rejected');
    var mailed = false;
    if (remaining(env) >= 1)
      try {
        send(env, rejectMail(p));
        mailed = true;
      } catch (e) {
        mailed = false;
      }
    return { ok: true, status: 'rejected', mailed: mailed };
  }

  /**
   * One call from Drashti: its JSON text in, { payload, sig } out. The payload is JSON text (ASCII), signed
   * with the list's key; it echoes the call's op, nonce and computer id, and says the list's time.
   */
  function handle(env, text) {
    var seen = { op: '', nonce: '', computerId: '' };
    var answer;
    try {
      var call = readCall(text, seen);
      var props = needProps(env);
      if (call.op === 'request') answer = request(env, props, call);
      else if (call.op === 'status') answer = status(env, props, call);
      else if (call.op === 'redeem') answer = redeem(env, props, call);
      else if (call.op === 'check') answer = check(env, props, call);
      else answer = owner(env, props, call);
    } catch (e) {
      if (isRefusal(e)) answer = { ok: false, error: e.refusal, message: e.message };
      else {
        if (env.log) env.log('The list failed: ' + String(e && e.stack ? e.stack : e));
        answer = { ok: false, error: 'server', message: MESSAGES.server };
      }
    }
    var body = {
      v: PROTOCOL.version,
      op: seen.op,
      nonce: seen.nonce,
      computerId: seen.computerId,
      serverTime: env.now(),
    };
    Object.keys(answer).forEach(function (k) {
      body[k] = answer[k];
    });
    var payload = asciiOnly(JSON.stringify(body));
    var sig = '';
    try {
      var props2 = env.props();
      if (props2 && props2.hasSigningKey) sig = env.sign(payload);
    } catch (e) {
      // Unsigned: Drashti believes none of it.
      if (env.log) env.log('The list could not sign its answer: ' + String(e && e.message ? e.message : e));
      sig = '';
    }
    return { payload: payload, sig: sig };
  }

  // ---- the Approve and Reject links ----

  /** What a link is, read without changing anything: a page that says so, with one button when it works. */
  function readLink(env, props, params) {
    var p = isObject(params) ? params : {};
    var action = p.a === 'approve' || p.a === 'reject' ? p.a : '';
    var requestId = String(p.r || '');
    var expires = String(p.x || '');
    var sig = String(p.s || '');
    if (!action || !HEX32.test(requestId) || !/^[0-9]{1,15}$/.test(expires) || !HEX64.test(sig))
      return { kind: 'forged' };
    var right = env.hmacHex(props.linkKey, 'drashti-link\n' + action + '\n' + requestId + '\n' + expires);
    if (!sameText(right, sig)) return { kind: 'forged' };
    if (Number(expires) < env.now()) return { kind: 'out-of-date', action: action };
    return { kind: 'signed', action: action, requestId: requestId };
  }

  function findRequest(data, requestId) {
    var found = null;
    data.people.forEach(function (p) {
      if (!found && data.byKey[p.key] === p && p.requestId === requestId) found = p;
    });
    return found;
  }

  var LINK_WORDS = {
    forged: [
      'This link did not come from your access list',
      'Nothing was changed. Use the links in the list’s own emails.',
    ],
    'out-of-date': [
      'This link has run out',
      'Links work for 7 days. Answer in Drashti (View › Access List), or ask the person to request access again.',
    ],
    replaced: [
      'This request was replaced',
      'The same Gmail asked again, or its row was removed. Use the newest email.',
    ],
    'not-set-up': ['The access list is not set up', 'Open the Sheet, then Drashti › Set up….'],
  };

  function page(kind, extra) {
    var words = LINK_WORDS[kind] || ['', ''];
    var out = { kind: kind, title: words[0], lines: [words[1]], button: null, params: null, lengths: null };
    Object.keys(extra || {}).forEach(function (k) {
      out[k] = extra[k];
    });
    return out;
  }

  function answeredPage(p) {
    return page('used', {
      title: 'This request was already answered',
      lines: [
        p.gmail +
          ' was ' +
          (p.answered === 'approved' ? 'approved' : 'rejected') +
          ' already. Nothing more was changed.',
      ],
    });
  }

  /**
   * The page an Approve or Reject link opens (the web app's GET): what it is for and ONE button. Opening it
   * changes nothing, so an email scanner following the link does no harm.
   */
  function linkPage(env, params) {
    var props;
    try {
      props = needProps(env);
    } catch (e) {
      return page('not-set-up');
    }
    var l = readLink(env, props, params);
    if (l.kind !== 'signed') return page(l.kind);
    var data = load(env);
    var p = findRequest(data, l.requestId);
    if (!p) return page('replaced');
    if (p.answered) return answeredPage(p);
    var approve = l.action === 'approve';
    return page('ready', {
      title: (approve ? 'Approve ' : 'Reject ') + p.gmail + '?',
      lines: [
        'Name they typed: ' + (p.name || '(none)'),
        'Computer: ' + (p.requestComputer || '(not given)'),
        'Asked: ' + (p.requestAt ? env.formatTime(p.requestAt) : '(not known)'),
        approve
          ? 'Approving emails ' + p.gmail + ' a one-time token that lets one computer in.'
          : 'Rejecting tells ' + p.gmail + ' plainly, and nothing more happens.',
      ],
      button: approve ? 'Approve' : 'Reject',
      params: { a: params.a, r: params.r, x: params.x, s: params.s },
      // How long access lasts, chosen on the page: the one chosen when the owner added the Gmail, or Unlimited.
      lengths: approve
        ? {
            days: PROTOCOL.lengths.days.slice(),
            maxDays: PROTOCOL.lengths.maxDays,
            chosen: p.length === null || p.length === undefined ? UNLIMITED : p.length,
          }
        : null,
    });
  }

  /** The length an Approve page sent ('unlimited' or a number of days, as text); Unlimited when none was. */
  function linkLength(params) {
    var raw = isObject(params) ? params.length : undefined;
    if (raw === undefined || raw === null) return UNLIMITED;
    var s = String(raw).trim();
    if (s === UNLIMITED) return UNLIMITED;
    return /^[0-9]{1,4}$/.test(s) && lengthOk(Number(s)) ? Number(s) : null;
  }

  /** The approval's last line: until when. */
  function lengthWords(env, endsAt) {
    return endsAt === null
      ? 'Their access has no end: it lasts until you revoke it.'
      : 'Their access lasts until ' + env.formatTime(endsAt) + ', by the list’s clock.';
  }

  /** The button on a link's page pressed: the request approved or rejected, once. */
  function answerLink(env, params) {
    var props;
    try {
      props = needProps(env);
    } catch (e) {
      return page('not-set-up');
    }
    var l = readLink(env, props, params);
    if (l.kind !== 'signed') return page(l.kind);
    var length = l.action === 'approve' ? linkLength(params) : UNLIMITED;
    if (length === null) return page('refused', { title: 'Not done', lines: [MESSAGES['bad-length']] });
    try {
      return withLock(env, function () {
        var data = load(env);
        var p = findRequest(data, l.requestId);
        if (!p) return page('replaced');
        if (p.answered) return answeredPage(p);
        if (changedByHand(p)) takeInHandEdit(env, data, p);
        if (l.action === 'approve') {
          if (p.key === ownerKey(props) && length !== UNLIMITED) throw refusal('owner-row');
          var sent = grant(env, props, data, p, length);
          return page('done', {
            title: 'Approved',
            lines: [
              p.gmail + ' was emailed a one-time token. It runs out on ' + env.formatTime(sent.runsOut) + '.',
              lengthWords(env, sent.endsAt),
            ],
          });
        }
        if (p.key === ownerKey(props)) throw refusal('owner-row');
        var r = reject(env, data, p);
        return page('done', {
          title: 'Rejected',
          lines: [
            p.gmail + (r.mailed ? ' was told by email.' : ' could not be emailed today, but is rejected.'),
          ],
        });
      });
    } catch (e) {
      if (!isRefusal(e)) throw e;
      return page('refused', { title: 'Not done', lines: [e.message] });
    }
  }

  // ---- the owner's first way in (the Sheet's menu: Drashti › Let me in (the owner)…) ----

  /**
   * The owner's row, approved, and a grant: its token emailed to the approver's own address. The owner
   * types their Gmail and that token into Drashti like anyone. Computers of theirs already in stay in.
   */
  function letOwnerIn(env) {
    var props = needProps(env);
    return withLock(env, function () {
      var data = load(env);
      var key = ownerKey(props);
      var p = data.byKey[key];
      if (!p) {
        p = addPerson(env, data, {
          gmail: props.approverEmail.trim(),
          name: 'Owner',
          status: 'approved',
          statusSeen: 'approved',
          requestedAt: env.now(),
          approvedAt: env.now(),
        });
      } else if (changedByHand(p)) takeInHandEdit(env, data, p);
      var sent = grant(env, props, data, p, UNLIMITED);
      return { ok: true, to: p.gmail, runsOut: sent.runsOut };
    });
  }

  /** What the Sheet's tabs must have, for Set up… (Code.js) and for the stand-in's Sheet. */
  function sheetLayout() {
    return [PEOPLE, COMPUTERS].map(function (tab) {
      return {
        tab: tab,
        columns: TABLES[tab].map(function (c) {
          return {
            field: c.field,
            header: c.header,
            date: Boolean(c.date || c.ends),
            number: Boolean(c.number),
            hidden: Boolean(c.hidden),
          };
        }),
      };
    });
  }

  return {
    PROTOCOL: PROTOCOL,
    MESSAGES: MESSAGES,
    handle: handle,
    linkPage: linkPage,
    answerLink: answerLink,
    letOwnerIn: letOwnerIn,
    sheetLayout: sheetLayout,
    canonicalJson: canonicalJson,
    gmailKey: gmailKey,
    gmailShaped: gmailShaped,
    normaliseToken: normaliseToken,
    formatToken: formatToken,
    cleanText: cleanText,
    sameText: sameText,
  };
})();

if (typeof module !== 'undefined') module.exports = DrashtiAccess;
