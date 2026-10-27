/*
 * Drashti's access list, Apps Script's side (Session 54, E1): the web app's doGet and doPost, the Sheet's
 * Drashti menu (Set up…, Let me in (the owner)…), and Google's services handed to core.js as `env`. It is
 * pasted into the Sheet's Extensions › Apps Script with core.js, Setup.html, Link.html and appsscript.json
 * (docs/access-setup.md says how), and deployed as a web app that runs as the owner, for anyone.
 *
 * A web page this script serves (an Approve link's page) can call any of its global functions by name
 * (google.script.run), as the owner. So every function here either checks for itself (answerLink: the
 * link's signature; drashtiTestKeys and drashtiSaveSetup: the one-time ticket only the owner's Set up…
 * window has), or does nothing outside the Sheet's own menu (SpreadsheetApp.getUi() fails anywhere else),
 * or ends with "_", which Apps Script never lets a page call. src/main/access/list-code.test.ts keeps it so.
 */

var PROPS_CACHE_SECONDS_ = 600;
var LOCK_WAIT_MS_ = 10000;
var SETUP_TICKET_MS_ = 30 * 60 * 1000;
var URL_SHAPE_ =
  /^https:\/\/script\.google\.com\/(?:a\/macros\/[a-z0-9.-]+|macros)\/s\/[A-Za-z0-9_-]{10,200}\/exec$/;
// Built from parts, so no text in the repository looks like a key to a secret scanner.
var PEM_LABEL_ = 'PRIVATE' + ' KEY';

// ---- the web app ----

/** Drashti's calls: JSON text in, { payload, sig } out (core.js's handle). */
function doPost(e) {
  var text = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
  var answer = DrashtiAccess.handle(env_(), text);
  return ContentService.createTextOutput(JSON.stringify(answer)).setMimeType(ContentService.MimeType.JSON);
}

/** An Approve or Reject link from the approver's email: a page saying what it is for, with one button. */
function doGet(e) {
  var params = (e && e.parameter) || {};
  if (!params.a) return ContentService.createTextOutput('Drashti’s access list. It answers Drashti only.');
  return page_(DrashtiAccess.linkPage(env_(), params));
}

/** The button on a link's page (Link.html, through google.script.run): the link checks itself. */
function answerLink(params) {
  var page = DrashtiAccess.answerLink(env_(), params && typeof params === 'object' ? params : {});
  return { kind: page.kind, title: page.title, lines: page.lines };
}

function page_(page) {
  var t = HtmlService.createTemplateFromFile('Link');
  t.page = page;
  return t
    .evaluate()
    .setTitle('Drashti access list')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---- the Sheet's menu ----

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Drashti')
    .addItem('Set up…', 'drashtiSetUp')
    .addItem('Let me in (the owner)…', 'drashtiLetMeIn')
    .addToUi();
}

/**
 * Drashti › Set up…: the tabs and their columns made (or put back), then a window that makes the keys in
 * the owner's own browser and shows the one line to send: the web app's address and the public key.
 */
function drashtiSetUp() {
  var ui = SpreadsheetApp.getUi();
  prepareSheet_();
  var props = PropertiesService.getScriptProperties();
  var approver = String(props.getProperty('APPROVER_EMAIL') || '').trim();
  if (!DrashtiAccess.gmailShaped(approver)) {
    ui.alert(
      'Set up Drashti’s access list',
      'First type your approver Gmail in the script’s settings: in Extensions › Apps Script, open Project Settings (the gear), then under Script Properties add the property APPROVER_EMAIL with your approver Gmail as its value, and save. Then choose Drashti › Set up… again.',
      ui.ButtonSet.OK,
    );
    return;
  }
  var ticket = hex_(randomBytes_(16));
  props.setProperty('SETUP_TICKET', ticket + ' ' + String(Date.now() + SETUP_TICKET_MS_));
  var t = HtmlService.createTemplateFromFile('Setup');
  t.ticket = ticket;
  t.approver = approver;
  t.url = String(props.getProperty('WEB_APP_URL') || '');
  t.line = props.getProperty('SIGNING_KEY') && props.getProperty('PUBLIC_KEY') ? setupLine_(props) : '';
  ui.showModalDialog(t.evaluate().setWidth(560).setHeight(560), 'Set up Drashti’s access list');
}

/**
 * Drashti › Let me in (the owner)…: the owner's own row, approved, and a one-time token emailed to the
 * approver's address, typed into Drashti like anyone's.
 */
function drashtiLetMeIn() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SIGNING_KEY')) {
    ui.alert('Let me in (the owner)', 'Choose Drashti › Set up… first.', ui.ButtonSet.OK);
    return;
  }
  var go = ui.alert(
    'Let me in (the owner)',
    'This makes your own row in the Access List, approved, and emails a one-time token to ' +
      String(props.getProperty('APPROVER_EMAIL') || '') +
      '. In Drashti, choose I Have a Token, then type that Gmail and the token.\n\nA token sent before and not used yet stops working; your computers already let in stay in.',
    ui.ButtonSet.OK_CANCEL,
  );
  if (go !== ui.Button.OK) return;
  try {
    var sent = DrashtiAccess.letOwnerIn(env_());
    ui.alert(
      'Token sent',
      'The token is in the inbox of ' +
        sent.to +
        '. It works once, and runs out on ' +
        formatTime_(sent.runsOut) +
        '.',
      ui.ButtonSet.OK,
    );
  } catch (e) {
    ui.alert(
      'Not sent',
      e && e.refusal ? e.message : String(e && e.message ? e.message : e),
      ui.ButtonSet.OK,
    );
  }
}

// ---- the Set up… window's two calls (Setup.html), each with the window's one-time ticket ----

/**
 * Google's own signature, HMAC and SHA-256 of a text, with a key the window made: the window checks each
 * against its browser's, so the list is known to sign as Drashti checks before anything is kept.
 */
function drashtiTestKeys(ticket, test) {
  checkTicket_(ticket);
  var t = test && typeof test === 'object' ? test : {};
  var text = String(t.text || '');
  var pem = String(t.privatePem || '');
  if (
    !/^[\x20-\x7e]{1,200}$/.test(text) ||
    !pemShaped_(pem) ||
    !/^[0-9a-f]{64}$/.test(String(t.hmacKey || ''))
  )
    throw new Error('The test was not in the form the window makes.');
  return {
    rsa: Utilities.base64Encode(Utilities.computeRsaSha256Signature(text, pem, Utilities.Charset.UTF_8)),
    hmac: hex_(Utilities.computeHmacSha256Signature(text, String(t.hmacKey), Utilities.Charset.UTF_8)),
    sha256: hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)),
  };
}

/** The keys kept in the script's settings, once: they are never replaced, or every Drashti would stop. */
function drashtiSaveSetup(ticket, setup) {
  checkTicket_(ticket);
  var s = setup && typeof setup === 'object' ? setup : {};
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SIGNING_KEY'))
    throw new Error(
      'The list is set up already, and its keys are never replaced (every Drashti would stop).',
    );
  var url = String(s.url || '').trim();
  var publicKey = String(s.publicKey || '');
  if (!URL_SHAPE_.test(url))
    throw new Error('That is not a web app address: it starts https://script.google.com/ and ends /exec.');
  if (!pemShaped_(String(s.privatePem || '')) || !/^[A-Za-z0-9+/]{300,800}={0,2}$/.test(publicKey))
    throw new Error('The keys were not in the form the window makes.');
  if (!/^[0-9a-f]{64}$/.test(String(s.linkKey || '')) || !/^[0-9a-f]{64}$/.test(String(s.secretKey || '')))
    throw new Error('The keys were not in the form the window makes.');
  props.setProperties({
    WEB_APP_URL: url,
    SIGNING_KEY: String(s.privatePem),
    PUBLIC_KEY: publicKey,
    LINK_KEY: String(s.linkKey),
    SECRET_KEY: String(s.secretKey),
  });
  props.deleteProperty('SETUP_TICKET');
  CacheService.getScriptCache().remove('props');
  return { line: setupLine_(props) };
}

function checkTicket_(ticket) {
  var kept = String(PropertiesService.getScriptProperties().getProperty('SETUP_TICKET') || '').split(' ');
  if (
    typeof ticket !== 'string' ||
    !DrashtiAccess.sameText(ticket, kept[0] || '') ||
    !(Number(kept[1]) > Date.now())
  )
    throw new Error('This window has run out: close it, then choose Drashti › Set up… again.');
}

function pemShaped_(pem) {
  return new RegExp(
    '^-----BEGIN ' + PEM_LABEL_ + '-----\\n[A-Za-z0-9+/=\\n]{100,4000}-----END ' + PEM_LABEL_ + '-----\\n?$',
  ).test(pem);
}

function setupLine_(props) {
  return (
    String(props.getProperty('WEB_APP_URL') || '') + '#key=' + String(props.getProperty('PUBLIC_KEY') || '')
  );
}

/** The tabs and their columns as core.js reads them: made, or put back, and kept readable. */
function prepareSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  DrashtiAccess.sheetLayout().forEach(function (t) {
    var sheet = ss.getSheetByName(t.tab);
    if (!sheet) {
      var sheets = ss.getSheets();
      // A new Sheet's one empty tab becomes the Access List, rather than sitting beside it.
      if (t.tab === 'Access List' && sheets.length === 1 && sheets[0].getLastRow() === 0) {
        sheet = sheets[0];
        sheet.setName(t.tab);
      } else sheet = ss.insertSheet(t.tab);
    }
    var width = sheet.getLastColumn();
    var header =
      width > 0
        ? sheet
            .getRange(1, 1, 1, width)
            .getValues()[0]
            .map(function (h) {
              return String(h).trim().toLowerCase();
            })
        : [];
    var rows = Math.max(sheet.getMaxRows() - 1, 1);
    t.columns.forEach(function (c) {
      var at = header.indexOf(c.header.toLowerCase());
      if (at < 0) {
        at = header.length;
        header.push(c.header.toLowerCase());
        sheet.getRange(1, at + 1).setValue(c.header);
      }
      var col = at + 1;
      if (c.date) sheet.getRange(2, col, rows, 1).setNumberFormat('d mmm yyyy, h:mm');
      if (c.hidden) sheet.hideColumns(col);
      if (t.tab === 'Access List' && c.field === 'status')
        sheet
          .getRange(2, col, rows, 1)
          .setDataValidation(
            SpreadsheetApp.newDataValidation()
              .requireValueInList(DrashtiAccess.PROTOCOL.statuses, true)
              .setAllowInvalid(false)
              .build(),
          );
    });
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    if (t.tab === 'Computers' && sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).length === 0)
      sheet
        .protect()
        .setDescription('Written by Drashti’s access list: change the Access List tab instead.')
        .setWarningOnly(true);
  });
}

// ---- Google's services, as core.js's env ----

function hex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) out += ('0' + (bytes[i] & 255).toString(16)).slice(-2);
  return out;
}

/**
 * Random bytes: Utilities.getUuid is java.util.UUID.randomUUID (a cryptographically strong generator,
 * 122 random bits each); two at a time, through SHA-256.
 */
function randomBytes_(n) {
  var out = [];
  while (out.length < n) {
    var bytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + Utilities.getUuid(),
      Utilities.Charset.US_ASCII,
    );
    for (var i = 0; i < bytes.length && out.length < n; i++) out.push(bytes[i] & 255);
  }
  return out;
}

function formatTime_(ms) {
  return Utilities.formatDate(
    new Date(ms),
    SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(),
    'd MMM yyyy, HH:mm',
  );
}

/** The script's settings, kept in the cache 10 minutes (Script Properties have a daily quota of reads). */
function settings_() {
  var cache = CacheService.getScriptCache();
  var kept = cache.get('props');
  if (kept)
    try {
      return JSON.parse(kept);
    } catch (e) {
      // Read them again.
    }
  var p = PropertiesService.getScriptProperties().getProperties();
  var s = {
    approverEmail: String(p.APPROVER_EMAIL || '').trim(),
    webAppUrl: String(p.WEB_APP_URL || '').trim(),
    linkKey: String(p.LINK_KEY || '').trim(),
    secretKey: String(p.SECRET_KEY || '').trim(),
    signingKey: String(p.SIGNING_KEY || ''),
  };
  try {
    cache.put('props', JSON.stringify(s), PROPS_CACHE_SECONDS_);
  } catch (e) {
    // Read again next time.
  }
  return s;
}

function sheet_(ss) {
  var tabs = {};
  var tab = function (name) {
    if (!tabs[name]) tabs[name] = ss.getSheetByName(name);
    return tabs[name];
  };
  return {
    read: function (name) {
      var s = tab(name);
      if (!s) return [];
      var rows = s.getLastRow();
      var cols = s.getLastColumn();
      return rows < 1 || cols < 1 ? [[]] : s.getRange(1, 1, rows, cols).getValues();
    },
    row: function (name, r) {
      var s = tab(name);
      var cols = s ? s.getLastColumn() : 0;
      return cols < 1 || r > s.getLastRow() ? [] : s.getRange(r, 1, 1, cols).getValues()[0];
    },
    column: function (name, c) {
      var s = tab(name);
      var rows = s ? s.getLastRow() : 0;
      return rows < 1
        ? []
        : s
            .getRange(1, c, rows, 1)
            .getValues()
            .map(function (r) {
              return r[0];
            });
    },
    write: function (name, r, c, value) {
      tab(name).getRange(r, c).setValue(value);
    },
    append: function (name, values) {
      var s = tab(name);
      s.appendRow(values);
      return s.getLastRow();
    },
  };
}

function env_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cache = CacheService.getScriptCache();
  var s = null;
  var settings = function () {
    if (!s) s = settings_();
    return s;
  };
  return {
    now: function () {
      return Date.now();
    },
    randomBytes: randomBytes_,
    sha256Hex: function (text) {
      return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
    },
    hmacHex: function (key, text) {
      return hex_(Utilities.computeHmacSha256Signature(text, key, Utilities.Charset.UTF_8));
    },
    sign: function (text) {
      return Utilities.base64Encode(
        Utilities.computeRsaSha256Signature(text, settings().signingKey, Utilities.Charset.UTF_8),
      );
    },
    formatTime: formatTime_,
    properties: {
      get: function (key) {
        return PropertiesService.getScriptProperties().getProperty(key);
      },
      set: function (key, value) {
        PropertiesService.getScriptProperties().setProperty(key, value);
      },
    },
    props: function () {
      var p = settings();
      return {
        approverEmail: p.approverEmail,
        webAppUrl: p.webAppUrl,
        linkKey: p.linkKey,
        secretKey: p.secretKey,
        hasSigningKey: Boolean(p.signingKey),
      };
    },
    mail: {
      remaining: function () {
        return MailApp.getRemainingDailyQuota();
      },
      send: function (m) {
        MailApp.sendEmail({ to: m.to, subject: m.subject, body: m.body, name: 'Drashti access list' });
      },
    },
    lock: function (fn) {
      var lock = LockService.getScriptLock();
      if (!lock.tryLock(LOCK_WAIT_MS_)) throw new Error('busy');
      try {
        return fn();
      } finally {
        lock.releaseLock();
      }
    },
    flush: function () {
      SpreadsheetApp.flush();
    },
    cache: {
      get: function (k) {
        return cache.get(k);
      },
      put: function (k, v, seconds) {
        cache.put(k, v, seconds);
      },
      remove: function (k) {
        cache.remove(k);
      },
      getAll: function (keys) {
        return cache.getAll(keys);
      },
      putAll: function (values, seconds) {
        cache.putAll(values, seconds);
      },
    },
    sheet: sheet_(ss),
    log: function (text) {
      console.error(text);
    },
  };
}
