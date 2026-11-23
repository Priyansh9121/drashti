/* Separate Apps Script project. No Google APIs here; tests run exactly this receiver with local services. */
var DrashtiErrors = (function () {
  'use strict';
  var DAY = 86400000;
  var CODES = ['operation-failed', 'process-crashed', 'stream-failed'];
  var EVENTS = CODES.concat([
    'app-started',
    'import-completed',
    'show-started',
    'stream-started',
    'stream-stopped',
  ]);
  function object(v, keys) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    var names = Object.keys(v).sort();
    var expected = keys.split(',').sort();
    return (
      names.length === expected.length &&
      names.every(function (name, i) {
        return name === expected[i];
      })
    );
  }

  function number(n, max) {
    return Number.isSafeInteger(n) && n >= 0 && n <= max;
  }
  function shape(s, pattern) {
    return typeof s === 'string' && pattern.test(s);
  }
  function same(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }
  function valid(r) {
    return (
      object(
        r,
        'id,at,trigger,code,diagnosticsInstallId,mode,osRelease,computerId,accessEntryId,version,platform,arch,role,counts,dropped,events',
      ) &&
      (r.diagnosticsInstallId === null ||
        shape(
          r.diagnosticsInstallId,
          /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/,
        )) &&
      ['pro', 'simple'].indexOf(r.mode) >= 0 &&
      shape(r.osRelease, /^\d{1,5}(?:\.\d{1,5}){1,3}$/) &&
      shape(r.id, /^[a-f0-9]{32}$/) &&
      number(r.at, Number.MAX_SAFE_INTEGER) &&
      ['operator-error', 'crash', 'failed-stream'].indexOf(r.trigger) >= 0 &&
      CODES.indexOf(r.code) >= 0 &&
      shape(r.computerId, /^[a-f0-9]{64}$/) &&
      shape(r.accessEntryId, /^[a-f0-9]{32}$/) &&
      shape(r.version, /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-alpha\.\d{1,4}(?:\.\d{1,3})?)?$/) &&
      ['darwin', 'win32'].indexOf(r.platform) >= 0 &&
      ['arm64', 'x64', 'ia32'].indexOf(r.arch) >= 0 &&
      ['main', 'node'].indexOf(r.role) >= 0 &&
      object(r.counts, 'minutes,shows,streams,recordings,imports') &&
      Object.keys(r.counts).every(function (k) {
        return number(r.counts[k], 1000000000);
      }) &&
      number(r.dropped, 1000000000) &&
      Array.isArray(r.events) &&
      r.events.length <= 30 &&
      r.events.every(function (e) {
        return (
          object(e, 'at,code,count') &&
          number(e.at, Number.MAX_SAFE_INTEGER) &&
          EVENTS.indexOf(e.code) >= 0 &&
          number(e.count, 1000000000)
        );
      })
    );
  }
  function handle(env, text) {
    try {
      if (typeof text !== 'string' || text.length > 70000) return { ok: false, error: 'invalid' };
      var call = JSON.parse(text);
      if (
        !object(call, 'v,installId,payload,mac') ||
        call.v !== 1 ||
        !shape(call.installId, /^[a-f0-9]{32}$/) ||
        typeof call.payload !== 'string' ||
        call.payload.length > 65536 ||
        !shape(call.mac, /^[a-f0-9]{64}$/)
      )
        return { ok: false, error: 'invalid' };
      var key = env.secret(call.installId);
      if (
        !shape(key, /^[a-f0-9]{64}$/) ||
        !same(call.mac, env.hmac(key, 'drashti-errors-v1\n' + call.installId + '\n' + call.payload))
      )
        return { ok: false, error: 'auth' };
      var report = JSON.parse(call.payload);
      if (!valid(report)) return { ok: false, error: 'invalid' };
      return env.lock(function () {
        var rows = env.rows(call.installId);
        if (
          rows.some(function (r) {
            return r.id === report.id;
          })
        )
          return { ok: true, id: report.id };
        var day = Math.floor(env.now() / DAY);
        if (
          rows.filter(function (r) {
            return Math.floor(r.received / DAY) === day;
          }).length >= 10
        )
          return { ok: false, error: 'limit' };
        // Deterministic filename recovers a file left by a failed Sheet append. Never store unvalidated payload text.
        var fileId = env.file(call.installId, report.id, JSON.stringify(report));
        env.append(call.installId, report, fileId);
        return { ok: true, id: report.id };
      });
    } catch {
      return { ok: false, error: 'unavailable' };
    }
  }
  return { handle: handle };
})();
if (typeof module !== 'undefined') module.exports = DrashtiErrors;
