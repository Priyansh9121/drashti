/* global DrashtiErrors, PropertiesService, LockService, SpreadsheetApp, DriveApp, Utilities, ContentService */
/* Paste into a NEW project, never over the access-list Code.js. No email and no remotely callable setup helper. */
function doPost(e) {
  var text = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
  var answer;
  try {
    answer = DrashtiErrors.handle(errorEnv_(), text);
  } catch {
    answer = { ok: false, error: 'unavailable' };
  }
  return ContentService.createTextOutput(JSON.stringify(answer)).setMimeType(ContentService.MimeType.JSON);
}

function errorEnv_() {
  var props = PropertiesService.getScriptProperties();
  var sheet;
  var folder;
  function reports() {
    if (!sheet) {
      var book = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
      sheet = book.getSheetByName('Automatic errors');
      if (!sheet) sheet = book.insertSheet('Automatic errors');
      if (sheet.getLastRow() === 0) {
        sheet.appendRow([
          'Install id',
          'Report id',
          'Received ms',
          'Occurred ms',
          'Computer id',
          'Access entry id',
          'Version',
          'OS',
          'Architecture',
          'Role',
          'Trigger',
          'Error code',
          'Minutes',
          'Shows',
          'Streams',
          'Recordings',
          'Imports',
          'Dropped',
          'Log file id',
          'Diagnostics install id',
          'Mode',
          'OS release',
        ]);
        sheet.setFrozenRows(1);
      }
      // Also finish an interrupted first setup before reading or writing any ids.
      // IDs and versions are text, even when all digits: preserve leading zeroes and exact duplicate keys.
      sheet.getRange('A:B').setNumberFormat('@');
      sheet.getRange('E:L').setNumberFormat('@');
      sheet.getRange('S:V').setNumberFormat('@');
    }
    return sheet;
  }
  return {
    now: function () {
      return Date.now();
    },
    secret: function (installId) {
      return props.getProperty('INSTALL_' + installId);
    },
    hmac: function (key, text) {
      return Utilities.computeHmacSha256Signature(text, key, Utilities.Charset.UTF_8)
        .map(function (b) {
          return ('0' + ((b + 256) % 256).toString(16)).slice(-2);
        })
        .join('');
    },
    lock: function (run) {
      var lock = LockService.getScriptLock();
      if (!lock.tryLock(1000)) throw new Error('busy');
      try {
        return run();
      } finally {
        lock.releaseLock();
      }
    },
    rows: function (installId) {
      var s = reports();
      if (s.getLastRow() < 2) return [];
      return s
        .getRange(2, 1, s.getLastRow() - 1, 3)
        .getValues()
        .filter(function (r) {
          return r[0] === installId;
        })
        .map(function (r) {
          return { id: String(r[1]), received: Number(r[2]) };
        });
    },
    file: function (installId, id, text) {
      if (!folder) folder = DriveApp.getFolderById(props.getProperty('FOLDER_ID'));
      var name = installId + '-' + id + '.json';
      var existing = folder.getFilesByName(name);
      if (existing.hasNext()) return existing.next().getId();
      return folder.createFile(name, text, 'application/json').getId();
    },
    append: function (installId, r, fileId) {
      reports().appendRow([
        installId,
        r.id,
        Date.now(),
        r.at,
        r.computerId,
        r.accessEntryId,
        r.version,
        r.platform,
        r.arch,
        r.role,
        r.trigger,
        r.code,
        r.counts.minutes,
        r.counts.shows,
        r.counts.streams,
        r.counts.recordings,
        r.counts.imports,
        r.dropped,
        fileId,
        r.diagnosticsInstallId || 'none',
        r.mode,
        r.osRelease,
      ]);
      SpreadsheetApp.flush();
    },
  };
}
