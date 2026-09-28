#!/bin/bash
#
# Drashti audit kit: ProPresenter 6 Mac
#
# A read-only inventory of this Mac for the move from ProPresenter to Drashti.
# It reads system information and ProPresenter's own files, then writes
# audit-report.md and audit.json into a new folder named after this Mac.
#
# It never changes settings, never edits, moves or deletes your files, and
# needs no installs and no administrator password. The optional --collect
# step only COPIES files to the destination you give it.
#
# Run it with:   bash audit-mac.sh            (see README.md for details)
#
if [ -z "${BASH_VERSION:-}" ]; then exec /bin/bash "$0" "$@"; fi

set -o pipefail
umask 077
export LC_ALL=C
PATH="/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export PATH

SCRIPT_VERSION="1.0.1"
# For the self-tests only: a folder that stands in for / when looking in the
# machine-wide places (/Library/Application Support, /Users/Shared), so a test
# can pretend to be a Mac with no ProPresenter data at all. Empty on real runs.
SYS_ROOT="${DRASHTI_AUDIT_SYSTEM_ROOT:-}"
SCHEMA="drashti-audit/1"
MEDIA_EXT_RE='^(mp4|m4v|mov|qt|avi|wmv|mkv|mpg|mpeg|mts|m2ts|ts|webm|flv|3gp|mxf|dv|jpg|jpeg|png|gif|bmp|tif|tiff|heic|webp|psd|mp3|wav|aif|aiff|m4a|aac|flac|ogg|wma|caf)$'
PP_DOC_RE='\.(pro6|pro5|pro4|pro6pl|pro6x|pro6plx|pro6template|pro|probundle|proplaylist)$'
SKIP_EXT_RE='^(sqlite|sqlite-wal|sqlite-shm|db|log|txt|json|plist|mscrasheslogbuffer|ttf|otf|ttc|otc|dfont|woff|woff2|pdf|dmg|pkg|zip|app|strings|nib|car|icns)$'
LEGACY_FONT_RE='gopika|terafont|lmg[-_ ]|shree[-_ ]?(guj|dev)|shreelipi|shree lipi|kruti ?dev|devlys|chanakya|aps[-_ ]?dv|akruti|sulekh'
DRASHTI_SENSITIVE_RE='licen[cs]e|regist|serial|unlock|activat|passw|passcode|pwd|secret|token|api[_ -]?key|auth|credential|stream[_ -]?key|streamkey|private[_ -]?key|rtmp|e-?mail|ccli'
export DRASHTI_SENSITIVE_RE LEGACY_FONT_RE MEDIA_EXT_RE SKIP_EXT_RE

usage() {
  cat <<'USAGE'
Drashti audit kit for the ProPresenter 6 Mac (read-only).

Usage:
  bash audit-mac.sh [options]

Options:
  --out DIR          Put the report folder inside DIR (default: next to this script)
  --collect DEST     Also COPY ProPresenter data folders and non-default fonts to DEST
                     (for example a USB drive: --collect /Volumes/USBNAME)
  --no-media         With --collect: leave out video, image and audio files
  --search-root DIR  Also look for ProPresenter files under DIR (repeatable)
  --no-spotlight     Do not use Spotlight to find ProPresenter files
  --skip-system      Skip the hardware, display, audio and device sections (testing)
  -h, --help         Show this help
USAGE
}

OUT_BASE=""
COLLECT_DEST=""
NO_MEDIA=0
USE_SPOTLIGHT=1
SKIP_SYSTEM=0
SEARCH_ROOTS=()

need_value() {
  if [ -z "${2:-}" ]; then echo "Option $1 needs a value (try --help)." >&2; exit 2; fi
}
while [ $# -gt 0 ]; do
  case "$1" in
    --out) need_value "$1" "${2:-}"; OUT_BASE="$2"; shift 2 ;;
    --collect) need_value "$1" "${2:-}"; COLLECT_DEST="$2"; shift 2 ;;
    --no-media) NO_MEDIA=1; shift ;;
    --search-root) need_value "$1" "${2:-}"; SEARCH_ROOTS+=("$2"); shift 2 ;;
    --no-spotlight) USE_SPOTLIGHT=0; shift ;;
    --skip-system) SKIP_SYSTEM=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

log() { printf '%s\n' "$*" >&2; }
step() { log ""; log "== $*"; }

SCRIPT_DIR=$(cd "$(dirname "$0")" 2>/dev/null && pwd -P)
[ -n "$OUT_BASE" ] || OUT_BASE="$SCRIPT_DIR"
if [ ! -d "$OUT_BASE" ]; then echo "Output folder not found: $OUT_BASE" >&2; exit 2; fi
OUT_BASE=$(cd "$OUT_BASE" && pwd -P)

if [ -n "$COLLECT_DEST" ]; then
  if [ ! -d "$COLLECT_DEST" ]; then echo "Collect destination not found: $COLLECT_DEST" >&2; exit 2; fi
  COLLECT_DEST=$(cd "$COLLECT_DEST" && pwd -P)
fi

MACHINE_NAME=$(scutil --get ComputerName 2>/dev/null)
[ -n "$MACHINE_NAME" ] || MACHINE_NAME=$(hostname -s 2>/dev/null)
[ -n "$MACHINE_NAME" ] || MACHINE_NAME="mac"
SAFE_NAME=$(printf '%s' "$MACHINE_NAME" | tr -c 'A-Za-z0-9._-' '-' | tr -s '-' | sed 's/^-//; s/-$//')
[ -n "$SAFE_NAME" ] || SAFE_NAME="mac"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT_DIR="$OUT_BASE/${SAFE_NAME}_${STAMP}"
if ! mkdir "$OUT_DIR" 2>/dev/null; then
  echo "Cannot create $OUT_DIR. Use --out to pick a folder you can write to." >&2
  exit 1
fi

W=$(mktemp -d "/tmp/drashti-audit.XXXXXX") || { echo "Cannot create a temporary folder." >&2; exit 1; }
cleanup() { if [ -n "${DRASHTI_KEEP_WORK:-}" ]; then log "(work folder kept: $W)"; return; fi; case "$W" in /tmp/drashti-audit.*) rm -rf "$W" ;; esac; }
trap cleanup EXIT
trap 'log "Interrupted."; exit 130' INT TERM

: > "$W/errors.tsv"
err() {
  printf '%s\t%s\n' "$1" "$(printf '%s' "$2" | tr '\t\n\r' '   ')" >> "$W/errors.tsv"
  log "   ! $1: $2"
}

# ---------------------------------------------------------------------------
# Embedded awk programs (POSIX awk; tested with the awk that ships in macOS)
# ---------------------------------------------------------------------------

# XML property list -> "path<TAB>type<TAB>value" lines.
cat > "$W/plist.awk" <<'AWK'
BEGIN { RS = "<"; depth = 0 }
{
  gt = index($0, ">")
  if (gt == 0) next
  tag = substr($0, 1, gt - 1)
  text = substr($0, gt + 1)
  if (tag ~ /^[?!]/) next
  selfclose = 0
  if (substr(tag, length(tag), 1) == "/") { selfclose = 1; tag = substr(tag, 1, length(tag) - 1) }
  sub(/[ \t\r\n].*$/, "", tag)
  if (tag == "plist" || tag == "/plist") next
  if (tag == "key") { pk[depth] = xu(text); next }
  if (tag == "dict" || tag == "array") {
    seg = nseg()
    if (selfclose) { emit(pth(seg), tag, ""); next }
    depth++; ct[depth] = tag; ci[depth] = 0; sg[depth] = seg
    next
  }
  if (tag == "/dict" || tag == "/array") { if (depth > 0) depth--; next }
  if (tag == "true" || tag == "false") { emit(pth(nseg()), "bool", tag); next }
  if (tag == "string" || tag == "integer" || tag == "real" || tag == "date" || tag == "data") {
    seg = nseg()
    if (selfclose) { emit(pth(seg), tag, ""); next }
    if (tag == "data") { emit(pth(seg), "data", "[data]"); next }
    emit(pth(seg), tag, xu(text))
    next
  }
}
function nseg(  s) {
  if (depth == 0) return ""
  if (ct[depth] == "array") { s = ci[depth]; ci[depth]++; return s }
  return pk[depth]
}
function pth(seg,  p, i) {
  p = ""
  for (i = 2; i <= depth; i++) p = p (p == "" ? "" : "/") sg[i]
  if (depth >= 1 && seg != "") p = p (p == "" ? "" : "/") seg
  return p
}
function emit(p, t, v) { gsub(/[\t\r\n]+/, " ", v); print p "\t" t "\t" v }
function xu(s,  out, p, q, e) {
  out = ""
  while ((p = index(s, "&")) > 0) {
    out = out substr(s, 1, p - 1); s = substr(s, p); q = index(s, ";")
    if (q == 0 || q > 10) { out = out "&"; s = substr(s, 2); continue }
    e = substr(s, 2, q - 2)
    if (e == "amp") out = out "&"; else if (e == "lt") out = out "<"; else if (e == "gt") out = out ">"
    else if (e == "quot") out = out "\""; else if (e == "apos") out = out "'"
    else out = out "&" e ";"
    s = substr(s, q + 1)
  }
  return out s
}
AWK

# Shared helpers: JSON escaping, XML/URL decoding, base64, redaction.
cat > "$W/lib.awk" <<'AWK'
BEGIN { lib_init() }
function lib_init(  i, a) {
  if (LIB_READY) return
  LIB_READY = 1
  a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  for (i = 0; i < 64; i++) B64[substr(a, i + 1, 1)] = i
  B64["-"] = 62; B64["_"] = 63
  for (i = 1; i < 256; i++) BYTE[i] = sprintf("%c", i)
  BYTE[0] = ""
  for (i = 0; i < 256; i++) ASC[i] = "?"
  for (i = 32; i < 127; i++) ASC[i] = BYTE[i]
  ASC[9] = "\t"; ASC[10] = "\n"; ASC[13] = "\r"; ASC[0] = ""
  URLSAFE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~:/?#[]@!$&'()*+,;=%"
  SENS = ENVIRON["DRASHTI_SENSITIVE_RE"]
  if (SENS == "") SENS = "licen[cs]e|regist|serial|passw|secret|token|stream[_ -]?key|rtmp"
  LEGACY = ENVIRON["LEGACY_FONT_RE"]
  if (LEGACY == "") LEGACY = "gopika|terafont|kruti ?dev"
  HOMEDIR = ENVIRON["HOME"]
}
function jesc(s,  out, i, n, c) {
  if (index(s, "\"") == 0 && index(s, "\\") == 0 && s !~ /[^ -~]/) return "\"" s "\""
  out = ""; n = length(s)
  for (i = 1; i <= n; i++) {
    c = substr(s, i, 1)
    if (c == "\"") out = out "\\\""
    else if (c == "\\") out = out "\\\\"
    else if (c == "\n") out = out "\\n"
    else if (c == "\r") out = out "\\r"
    else if (c == "\t") out = out "\\t"
    else if (c < " ") out = out " "
    else out = out c
  }
  return "\"" out "\""
}
function mdesc(s,  out, p) {
  gsub(/[\t\r\n]+/, " ", s)
  out = ""
  while ((p = index(s, "|")) > 0) { out = out substr(s, 1, p - 1) "\\|"; s = substr(s, p + 1) }
  return out s
}
function trim(s) { sub(/^[ \t\r\n]+/, "", s); sub(/[ \t\r\n]+$/, "", s); return s }
function hex2num(h,  i, n, c) {
  n = 0; h = tolower(h)
  for (i = 1; i <= length(h); i++) { c = index("0123456789abcdef", substr(h, i, 1)) - 1; if (c < 0) return n; n = n * 16 + c }
  return n
}
function utf8(cp) {
  if (cp <= 0) return ""
  if (cp < 128) return BYTE[cp]
  if (cp < 2048) return BYTE[192 + int(cp / 64)] BYTE[128 + cp % 64]
  if (cp < 65536) return BYTE[224 + int(cp / 4096)] BYTE[128 + int(cp / 64) % 64] BYTE[128 + cp % 64]
  return BYTE[240 + int(cp / 262144)] BYTE[128 + int(cp / 4096) % 64] BYTE[128 + int(cp / 64) % 64] BYTE[128 + cp % 64]
}
function xmlunesc(s,  out, p, q, e) {
  out = ""
  while ((p = index(s, "&")) > 0) {
    out = out substr(s, 1, p - 1); s = substr(s, p); q = index(s, ";")
    if (q == 0 || q > 12) { out = out "&"; s = substr(s, 2); continue }
    e = substr(s, 2, q - 2)
    if (e == "amp") out = out "&"; else if (e == "lt") out = out "<"; else if (e == "gt") out = out ">"
    else if (e == "quot") out = out "\""; else if (e == "apos") out = out "'"
    else if (e ~ /^#[0-9]+$/) out = out utf8(substr(e, 2) + 0)
    else if (e ~ /^#[xX][0-9a-fA-F]+$/) out = out utf8(hex2num(substr(e, 3)))
    else out = out "&" e ";"
    s = substr(s, q + 1)
  }
  return out s
}
function pctdec(s,  out, p, h) {
  out = ""
  while ((p = index(s, "%")) > 0) {
    out = out substr(s, 1, p - 1); h = substr(s, p + 1, 2)
    if (h ~ /^[0-9A-Fa-f][0-9A-Fa-f]$/) { out = out BYTE[hex2num(h)]; s = substr(s, p + 3) }
    else { out = out "%"; s = substr(s, p + 1) }
  }
  return out s
}
function url2path(u) {
  if (u ~ /^file:\/\/localhost\//) u = substr(u, 17)
  else if (u ~ /^file:\/\//) u = substr(u, 8)
  else if (u ~ /^file:/) u = substr(u, 6)
  else return (substr(u, 1, 2) == "~/") ? HOMEDIR substr(u, 2) : u
  u = pctdec(u)
  if (u ~ /^\/[A-Za-z]:[\/\\]/) u = substr(u, 2)
  if (substr(u, 1, 2) == "~/") u = HOMEDIR substr(u, 2)
  return u
}
# Base64 -> ASCII text. Bytes outside printable ASCII become "?", NULs are
# dropped (so UTF-16 XML still reads as text).
function b64text(s,  out, chunk, n, i, c, q, nq) {
  out = ""; chunk = ""; n = length(s); q = 0; nq = 0
  for (i = 1; i <= n; i++) {
    c = substr(s, i, 1)
    if (!(c in B64)) { if (c == "=") break; continue }
    q = q * 64 + B64[c]; nq++
    if (nq == 4) {
      chunk = chunk ASC[int(q / 65536)] ASC[int(q / 256) % 256] ASC[q % 256]
      q = 0; nq = 0
      if (length(chunk) >= 3000) { out = out chunk; chunk = "" }
    }
  }
  if (nq == 2) chunk = chunk ASC[int(q / 16)]
  else if (nq == 3) chunk = chunk ASC[int(q / 1024)] ASC[int(q / 4) % 256]
  return out chunk
}
function redact_value(v) {
  if (v ~ /[Rr][Tt][Mm][Pp][Ss]?:\/\//) return "[REDACTED-STREAM-URL]"
  if (v ~ /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z][A-Za-z]+/) return "[REDACTED-EMAIL]"
  if (v ~ /(^|[^A-Za-z0-9])[A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9]?[A-Za-z0-9]?(-[A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9]?[A-Za-z0-9]?)(-[A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9]?[A-Za-z0-9]?)(-[A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9]?[A-Za-z0-9]?)+([^A-Za-z0-9]|$)/) return "[REDACTED-KEY]"
  return v
}
function is_sensitive_key(p) { return (tolower(p) ~ SENS) }
AWK

# Minimal RTF reader: font table + which fonts carry which kind of text.
cat > "$W/rtf.awk" <<'AWK'
function rtf_isalpha(c) { return ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z")) }
function rtf_count(f, cp) {
  if (cp >= 2688 && cp <= 2815) RG[f]++
  else if (cp >= 2304 && cp <= 2431) RH[f]++
  else if ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)) RL[f]++
  else if (cp > 127) RO[f]++
  else RN[f]++
}
# Scans one RTF document and prints FONT / FONTDECL records for RTF_FILE.
function rtf_scan(s,  n, i, c, nc, j, k, w, prm, d, skip, ftd, fidx, fname, uc, pend, key, cp) {
  delete FT; delete RL; delete RG; delete RH; delete RO; delete RN; delete CF
  n = length(s); i = 1; d = 0; skip = 0; ftd = 0; fidx = ""; fname = ""; uc = 1; pend = 0
  CF[0] = "0"
  while (i <= n) {
    c = substr(s, i, 1)
    if (c == "{") { d++; CF[d] = CF[d - 1]; i++; continue }
    if (c == "}") {
      if (ftd > 0 && d == ftd) ftd = 0
      if (skip > 0 && d == skip) skip = 0
      if (d > 0) d--
      i++; continue
    }
    if (c == "\\") {
      nc = substr(s, i + 1, 1)
      if (rtf_isalpha(nc)) {
        j = i + 1
        while (j <= n && rtf_isalpha(substr(s, j, 1))) j++
        w = substr(s, i + 1, j - i - 1)
        k = j
        if (substr(s, k, 1) == "-") k++
        while (k <= n && substr(s, k, 1) >= "0" && substr(s, k, 1) <= "9") k++
        prm = substr(s, j, k - j)
        if (substr(s, k, 1) == " ") k++
        i = k
        if (skip) continue
        if (w == "fonttbl") { ftd = d; continue }
        if (w ~ /^(colortbl|stylesheet|info|pict|expandedcolortbl|listtable|listoverridetable|header|footer|headerl|headerr|headerf|footerl|footerr|footerf|rsidtbl|generator|xmlnstbl|themedata|colorschememapping|latentstyles|datastore|fldinst|object|nonshppict|shppict|revtbl|filetbl|pgdsctbl|mmathPr|NeXTGraphic)$/) { skip = d; continue }
        if (ftd > 0) { if (w == "f") { fidx = prm; fname = "" } ; continue }
        if (w == "f") { CF[d] = prm; continue }
        if (w == "uc") { uc = prm + 0; continue }
        if (w == "u") { cp = prm + 0; if (cp < 0) cp += 65536; rtf_count(CF[d], cp); pend = uc; continue }
        continue
      }
      if (nc == "'") {
        if (!skip) {
          if (ftd > 0) fname = fname "\\'" substr(s, i + 2, 2)
          else if (pend > 0) pend--
          else rtf_count(CF[d], 128)
        }
        i += 4; continue
      }
      if (nc == "*") { if (!skip) skip = d; i += 2; continue }
      if (!skip && (nc == "\\" || nc == "{" || nc == "}")) {
        if (ftd > 0) fname = fname nc
        else if (pend > 0) pend--
        else rtf_count(CF[d], 0)
      }
      i += 2; continue
    }
    if (c == "\n" || c == "\r") { i++; continue }
    if (skip) { i++; continue }
    if (ftd > 0) {
      if (c == ";") { if (fidx != "") FT[fidx] = trim(fname); fidx = ""; fname = "" }
      else fname = fname c
      i++; continue
    }
    if (pend > 0) { pend--; i++; continue }
    if (rtf_isalpha(c)) RL[CF[d]]++
    else if (c == "?") RO[CF[d]]++
    else if (c != " ") RN[CF[d]]++
    i++
  }
  for (key in FT) {
    if (FT[key] == "") continue
    if (RL[key] + RG[key] + RH[key] + RO[key] + RN[key] > 0)
      print "FONT\t" FT[key] "\t" RTF_FILE "\t" (RL[key] + 0) "\t" (RG[key] + 0) "\t" (RH[key] + 0) "\t" (RO[key] + 0) "\trtf"
    else
      print "FONTDECL\t" FT[key] "\t" RTF_FILE
  }
}
# XAML (PP6 for Windows "WinFlowData"): FontFamily="..." attributes.
function xaml_scan(s,  p, rest, q, v) {
  while ((p = index(s, "FontFamily=\"")) > 0) {
    rest = substr(s, p + 12); q = index(rest, "\"")
    if (q == 0) break
    v = trim(substr(rest, 1, q - 1)); s = substr(rest, q + 1)
    if (v != "" && v !~ /^\{/) print "FONT\t" v "\t" RTF_FILE "\t\t\t\t\txaml"
  }
}
AWK

# ProPresenter 4/5/6 XML documents and playlists.
cat > "$W/ppxml.awk" <<'AWK'
FNR == 1 { ppx_flush(); RTF_FILE = (SRCFILE != "" ? SRCFILE : FILENAME); ns = ng = nt = npl = nm = 0; open = 1 }
{
  line = $0
  ns += ppx_count(line, "<RVDisplaySlide")
  ng += ppx_count(line, "<RVSlideGrouping")
  nt += ppx_count(line, "<RVTextElement")
  npl += ppx_count(line, "<RVPlaylistNode")
  nm += ppx_count(line, "<RVMediaCue")
  ppx_ivar(line, "RTFData", "rtf"); ppx_attr(line, "RTFData", "rtf")
  ppx_ivar(line, "WinFlowData", "xaml"); ppx_attr(line, "WinFlowData", "xaml")
  ppx_paths(line, "source", "MEDIA")
  ppx_paths(line, "filePath", "DOC")
}
END { ppx_flush() }
function ppx_flush() {
  if (open) print "STAT\t" RTF_FILE "\txml\t" ns "\t" ng "\t" nt "\t" npl "\t" nm
  open = 0
}
function ppx_count(s, pat,  n, p) { n = 0; while ((p = index(s, pat)) > 0) { n++; s = substr(s, p + length(pat)) } return n }
function ppx_blob(v, kind) {
  if (length(v) < 8) return
  if (kind == "rtf") rtf_scan(b64text(v)); else xaml_scan(b64text(v))
}
function ppx_ivar(s, name, kind,  pat, p, rest, q) {
  pat = "rvXMLIvarName=\"" name "\">"
  while ((p = index(s, pat)) > 0) {
    rest = substr(s, p + length(pat)); q = index(rest, "<")
    if (q > 0) { ppx_blob(substr(rest, 1, q - 1), kind); s = substr(rest, q) }
    else { ppx_blob(rest, kind); s = "" }
  }
}
function ppx_attr(s, name, kind,  pat, p, rest, q) {
  pat = " " name "=\""
  while ((p = index(s, pat)) > 0) {
    rest = substr(s, p + length(pat)); q = index(rest, "\"")
    if (q == 0) break
    ppx_blob(substr(rest, 1, q - 1), kind); s = substr(rest, q + 1)
  }
}
function ppx_paths(s, attr, tag,  pat, p, rest, q, v) {
  pat = " " attr "=\""
  while ((p = index(s, pat)) > 0) {
    rest = substr(s, p + length(pat)); q = index(rest, "\"")
    if (q == 0) break
    v = substr(rest, 1, q - 1); s = substr(rest, q + 1)
    if (v == "") continue
    v = xmlunesc(v)
    if (v ~ /^(file:|\/|~\/|[A-Za-z]:[\\\/]|\\\\)/) print tag "\t" url2path(v) "\t" RTF_FILE
  }
}
AWK

# ProPresenter 7 protobuf (.pro) read as bytes from `od -An -v -tu1`.
cat > "$W/ppbin.awk" <<'AWK'
{ for (i = 1; i <= NF; i++) b[++nb] = $i + 0 }
END {
  RTF_FILE = SRCFILE; nr = 0
  for (i = 1; i <= nb - 5; i++) {
    if (b[i] == 123 && b[i+1] == 92 && b[i+2] == 114 && b[i+3] == 116 && b[i+4] == 102) {
      d = 0; esc = 0; s = ""; chunk = ""
      for (j = i; j <= nb; j++) {
        c = b[j]
        if (esc) esc = 0
        else if (c == 92) esc = 1
        else if (c == 123) d++
        else if (c == 125) d--
        chunk = chunk ASC[c]
        if (length(chunk) >= 3000) { s = s chunk; chunk = "" }
        if (d == 0) break
      }
      rtf_scan(s chunk); nr++
      i = j
    }
  }
  for (i = 2; i <= nb - 7; i++) {
    if (b[i] == 102 && b[i+1] == 105 && b[i+2] == 108 && b[i+3] == 101 && b[i+4] == 58 && b[i+5] == 47 && b[i+6] == 47) {
      len = vlen(i)
      if (len >= 8 && i + len - 1 <= nb && printable(i, len)) { print "MEDIA\t" url2path(bstr(i, len)) "\t" RTF_FILE; i += len - 1 }
      else {
        j = i
        while (j <= nb && b[j] < 128 && index(URLSAFE, BYTE[b[j]]) > 0) j++
        print "MEDIA\t" url2path(bstr(i, j - i)) "\t" RTF_FILE "\tapprox"; i = j - 1
      }
    }
  }
  for (i = 2; i <= nb - 3; i++) {
    c = b[i]
    if (((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) && b[i+1] == 58 && (b[i+2] == 92 || b[i+2] == 47)) {
      len = vlen(i)
      if (len >= 6 && i + len - 1 <= nb && printable(i, len)) {
        p = bstr(i, len)
        if (p ~ /\.[A-Za-z0-9]+$/) { print "MEDIA\t" p "\t" RTF_FILE; i += len - 1 }
      }
    }
  }
  print "STAT\t" RTF_FILE "\tprotobuf\t\t\t" nr "\t\t"
}
function vlen(i,  k, v, m, t) {
  if (i < 2 || b[i-1] >= 128) return -1
  k = i - 1
  while (k - 1 >= 1 && b[k-1] >= 128 && (i - k) < 4) k--
  v = 0; m = 1
  for (t = k; t <= i - 1; t++) { v += (b[t] % 128) * m; m *= 128 }
  return v
}
function printable(i, len,  t) { for (t = i; t < i + len; t++) if (b[t] < 32 || b[t] == 127) return 0; return 1 }
function bstr(i, len,  t, s, ch) {
  s = ""; ch = ""
  for (t = i; t < i + len; t++) { ch = ch BYTE[b[t]]; if (length(ch) >= 2000) { s = s ch; ch = "" } }
  return s ch
}
AWK

# system_profiler flattened -> GPU rows.
cat > "$W/sp_gpus.awk" <<'AWK'
BEGIN { FS = "\t" }
{
  n = split($1, s, "/")
  if (n == 4 && s[1] == "0" && s[2] == "_items") { g = s[3]; if (!(g in seen)) { seen[g] = 1; ord[++cnt] = g }; v[g, s[4]] = $3 }
}
END {
  for (i = 1; i <= cnt; i++) {
    g = ord[i]
    name = v[g, "sppci_model"]; if (name == "") name = v[g, "_name"]
    vendor = v[g, "spdisplays_vendor"]; if (vendor == "") vendor = v[g, "sppci_vendor"]
    sub(/^sppci_vendor_/, "", vendor)
    vram = v[g, "spdisplays_vram"]; if (vram == "") vram = v[g, "spdisplays_vram_shared"]; if (vram == "") vram = v[g, "_spdisplays_vram"]
    metal = v[g, "spdisplays_mtlgpufamilysupport"]; if (metal == "") metal = v[g, "spdisplays_metal"]
    sub(/^spdisplays_/, "", metal)
    bus = v[g, "sppci_bus"]; sub(/^spdisplays_/, "", bus)
    print g "\t" name "\t" vendor "\t" vram "\t" v[g, "sppci_cores"] "\t" metal "\t" bus
  }
}
AWK

# system_profiler flattened -> display rows (never includes serial numbers).
cat > "$W/sp_displays.awk" <<'AWK'
BEGIN { FS = "\t" }
{
  n = split($1, s, "/")
  if (n == 6 && s[1] == "0" && s[2] == "_items" && s[4] == "spdisplays_ndrvs") {
    id = s[3] "/" s[5]
    if (!(id in seen)) { seen[id] = 1; ord[++cnt] = id; gpu[id] = s[3] }
    v[id, s[6]] = $3
  }
}
END {
  for (i = 1; i <= cnt; i++) {
    id = ord[i]
    res = v[id, "_spdisplays_resolution"]; if (res == "") res = v[id, "spdisplays_resolution"]
    pix = v[id, "_spdisplays_pixels"]; if (pix == "") pix = v[id, "spdisplays_pixels"]
    hz = ""
    if (match(res, /@ *[0-9.]+ *Hz/)) { hz = substr(res, RSTART, RLENGTH); gsub(/[^0-9.]/, "", hz) }
    print gpu[id] "\t" v[id, "_name"] "\t" pix "\t" res "\t" hz "\t" cl(v[id, "spdisplays_main"]) "\t" cl(v[id, "spdisplays_mirror"]) "\t" cl(v[id, "spdisplays_online"]) "\t" cl(v[id, "spdisplays_connection_type"]) "\t" cl(v[id, "spdisplays_display_type"]) "\t" v[id, "_spdisplays_displayID"]
  }
}
function cl(x) { sub(/^spdisplays_/, "", x); return x }
AWK

# system_profiler flattened -> audio device rows.
cat > "$W/sp_audio.awk" <<'AWK'
BEGIN { FS = "\t" }
{
  k = $1; sub(/^.*\//, "", k)
  par = $1; if (!sub(/\/[^\/]*$/, "", par)) par = ""
  if (!(par in seen)) { seen[par] = 1; ord[++cnt] = par }
  v[par, k] = $3
  if (k ~ /^coreaudio_/) dev[par] = 1
}
END {
  for (i = 1; i <= cnt; i++) {
    p = ord[i]
    if (!(p in dev) || v[p, "_name"] == "") continue
    tr = v[p, "coreaudio_device_transport"]; sub(/^coreaudio_device_type_/, "", tr)
    print v[p, "_name"] "\t" v[p, "coreaudio_device_manufacturer"] "\t" tr "\t" v[p, "coreaudio_device_input"] "\t" v[p, "coreaudio_device_output"] "\t" v[p, "coreaudio_device_srate"] "\t" yn(v[p, "coreaudio_default_audio_output_device"]) "\t" yn(v[p, "coreaudio_default_audio_input_device"]) "\t" yn(v[p, "coreaudio_default_audio_system_device"])
  }
}
function yn(x) { return (x == "spaudio_yes" || x == "yes") ? "yes" : "no" }
AWK

# system_profiler flattened -> device rows (USB, Thunderbolt, PCI, cameras).
cat > "$W/sp_devices.awk" <<'AWK'
BEGIN { FS = "\t" }
{
  k = $1; sub(/^.*\//, "", k)
  par = $1; if (!sub(/\/[^\/]*$/, "", par)) par = ""
  if (!(par in seen)) { seen[par] = 1; ord[++cnt] = par }
  v[par, k] = $3
}
END {
  for (i = 1; i <= cnt; i++) {
    p = ord[i]
    name = v[p, "_name"]; if (name == "") name = v[p, "USBDeviceKeyProductName"]; if (name == "") name = v[p, "device_name_key"]
    if (name == "" || p !~ /_items/) continue
    vendor = v[p, "manufacturer"]
    if (vendor == "") vendor = v[p, "USBDeviceKeyVendorName"]
    if (vendor == "") vendor = v[p, "vendor_name_key"]
    if (vendor == "") vendor = v[p, "sppci_vendor-id"]
    if (vendor == "") vendor = v[p, "vendor_id"]
    else if (v[p, "vendor_id"] != "") vendor = vendor " (" v[p, "vendor_id"] ")"
    prod = v[p, "product_id"]; if (prod == "") prod = v[p, "USBDeviceKeyProductID"]; if (prod == "") prod = v[p, "sppci_device-id"]; if (prod == "") prod = v[p, "spcamera_model-id"]
    print SRC "\t" name "\t" vendor "\t" prod
  }
}
AWK

cat > "$W/classify.awk" <<'AWK'
BEGIN { FS = "\t" }
{
  s = tolower($2 " " $3 " " $4); cat = "other"
  if (s ~ /stream ?deck/) cat = "stream-deck"
  else if (s ~ /blackmagic|decklink|ultrastudio|intensity|web presenter|atem|aja |aja$|kona|io 4k|io x3|t-tap|u-tap|magewell|epiphan|avermedia|cam ?link|game capture|hd60|4k60 pro|capture|grabber|matrox|bluefish|deltacast|0x1edb/) cat = "capture-sdi"
  else if (s ~ /midi|launchpad|launchkey|apc ?(mini|40|key)|x-?touch|nanokontrol|nanokey|korg|akai|novation|arturia|m-audio|irig|keystation|bcf2000|bcr2000/) cat = "midi"
  else if ($1 == "SPCameraDataType") cat = "camera"
  print cat "\t" $2 "\t" $3 "\t" $4 "\t" $1
}
AWK

# Preferences: redact, and pull out values that look like paths.
cat > "$W/prefs.awk" <<'AWK'
BEGIN { FS = "\t" }
{
  p = $1; t = $2; v = $3
  if (t == "data") v = "[binary data]"
  else if (t != "dict" && t != "array" && is_sensitive_key(p)) v = "[REDACTED]"
  else v = redact_value(v)
  print PFILE "\t" p "\t" t "\t" v
  if (t == "string" && v !~ /^\[REDACTED/ && v ~ /^(\/|~\/|file:)/) print url2path(v) "\t" p "\t" PFILE >> PATHS
}
AWK

# TSV -> JSON array of objects. SPEC is "name:type,..." with types
# s (string), S (string or null), n (number or null), b (boolean or null).
cat > "$W/tsv2json.awk" <<'AWK'
BEGIN {
  FS = "\t"; nc = split(SPEC, cols, ",")
  for (i = 1; i <= nc; i++) { split(cols[i], kv, ":"); cn[i] = kv[1]; ctp[i] = kv[2] }
  printf "["; first = 1
}
{
  printf "%s\n    {", (first ? "" : ","); first = 0
  for (i = 1; i <= nc; i++) {
    v = $i
    if (ctp[i] == "n") o = (v ~ /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/) ? v : "null"
    else if (ctp[i] == "b") o = (v == "yes" || v == "true") ? "true" : ((v == "no" || v == "false") ? "false" : "null")
    else if (ctp[i] == "S") o = (v == "") ? "null" : jesc(v)
    else o = jesc(v)
    printf "%s%s: %s", (i > 1 ? ", " : ""), jesc(cn[i]), o
  }
  printf "}"
}
END { printf "%s]", (first ? "" : "\n  ") }
AWK

# "key<TAB>value<TAB>type" -> JSON object.
cat > "$W/kv2json.awk" <<'AWK'
BEGIN { FS = "\t"; printf "{"; first = 1 }
{
  v = $2
  if ($3 == "n") o = (v ~ /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/) ? v : "null"
  else if ($3 == "b") o = (v == "yes" || v == "true") ? "true" : ((v == "no" || v == "false") ? "false" : "null")
  else o = jesc(v)
  printf "%s\n    %s: %s", (first ? "" : ","), jesc($1), o; first = 0
}
END { printf "%s}", (first ? "" : "\n  ") }
AWK

# TSV -> Markdown table. HEAD is "Col|Col|...", COLS picks input columns
# ("1,3,2"), MAX caps the rows.
cat > "$W/tsv2md.awk" <<'AWK'
BEGIN {
  FS = "\t"; nh = split(HEAD, h, "|"); nc = split(COLS, c, ",")
  line = "|"; sep = "|"
  for (i = 1; i <= nh; i++) { line = line " " h[i] " |"; sep = sep " --- |" }
  rows = 0; more = 0
}
{
  if (MAX > 0 && rows >= MAX) { more++; next }
  if (rows == 0) { print line; print sep }
  rows++
  r = "|"
  for (i = 1; i <= nc; i++) r = r " " mdesc($(c[i])) " |"
  print r
}
END {
  if (rows == 0) print "_None found._"
  if (more > 0) print "\n_...and " more " more rows (see audit.json)._"
}
AWK

cat > "$W/jstr.awk" <<'AWK'
{ s = (NR > 1 ? s "\n" : "") $0 }
END { printf "%s", jesc(s) }
AWK

# JXA helper: current display modes and installed font names.
cat > "$W/mac.js" <<'JXA'
ObjC.import('AppKit');
ObjC.import('CoreGraphics');
function run(argv) {
  var what = argv[0], lines = [], i;
  if (what === 'screens') {
    var screens = $.NSScreen.screens;
    var mainH = 0;
    if (screens.count > 0) mainH = screens.objectAtIndex(0).frame.size.height;
    for (i = 0; i < screens.count; i++) {
      var s = screens.objectAtIndex(i);
      var num = s.deviceDescription.objectForKey('NSScreenNumber').unsignedIntValue;
      var mode = $.CGDisplayCopyDisplayMode(num);
      var f = s.frame, name = '';
      try { name = s.localizedName.js || ''; } catch (e) { name = ''; }
      lines.push([
        num, name,
        Number($.CGDisplayModeGetPixelWidth(mode)), Number($.CGDisplayModeGetPixelHeight(mode)),
        Number(f.size.width), Number(f.size.height),
        Math.round(Number($.CGDisplayModeGetRefreshRate(mode)) * 100) / 100,
        Number(f.origin.x), Number(mainH - (f.origin.y + f.size.height)),
        Number(s.backingScaleFactor),
        $.CGDisplayIsMain(num) ? 'yes' : 'no',
        $.CGDisplayIsBuiltin(num) ? 'yes' : 'no',
        $.CGDisplayIsInMirrorSet(num) ? 'yes' : 'no',
        Number($.CGDisplayRotation(num))
      ].join('\t'));
    }
  } else if (what === 'fonts') {
    var fm = $.NSFontManager.sharedFontManager;
    var fam = fm.availableFontFamilies, fonts = fm.availableFonts;
    for (i = 0; i < fam.count; i++) lines.push('family\t' + fam.objectAtIndex(i).js);
    for (i = 0; i < fonts.count; i++) lines.push('font\t' + fonts.objectAtIndex(i).js);
  } else if (what === 'checkjson') {
    var str = $.NSString.stringWithContentsOfFileEncodingError(argv[1], $.NSUTF8StringEncoding, null);
    JSON.parse(str.js);
    return 'ok';
  }
  return lines.join('\n');
}
JXA

flat_get() { awk -F'\t' -v p="$2" '$1 == p { print $3; exit }' "$1"; }
sp_flat() { system_profiler -xml "$1" 2>/dev/null | awk -f "$W/plist.awk"; }
jstr() { printf '%s' "$1" | awk -f "$W/lib.awk" -f "$W/jstr.awk"; }
# A table file that was never written counts as empty (a Mac with no ProPresenter data has none).
tsv_json() { local f="$1"; [ -f "$f" ] || f=/dev/null; awk -f "$W/lib.awk" -f "$W/tsv2json.awk" -v SPEC="$2" "$f"; }
tsv_md() { local f="$1"; [ -f "$f" ] || f=/dev/null; awk -f "$W/lib.awk" -f "$W/tsv2md.awk" -v HEAD="$2" -v COLS="$3" -v MAX="${4:-0}" "$f"; }
lower() { printf '%s' "$1" | tr 'A-Z' 'a-z'; }
human() { awk -v b="${1:-0}" 'BEGIN { split("B KB MB GB TB", u, " "); i = 1; while (b >= 1024 && i < 5) { b /= 1024; i++ } if (i == 1) printf "%d %s", b, u[i]; else printf "%.1f %s", b, u[i] }'; }

MACHINE_TSV="$W/machine.tsv"; : > "$MACHINE_TSV"
mkv() { printf '%s\t%s\t%s\n' "$1" "$(printf '%s' "$2" | tr '\t\n\r' '   ')" "${3:-s}" >> "$MACHINE_TSV"; }
mget() { awk -F'\t' -v k="$1" '$1 == k { print $2; exit }' "$MACHINE_TSV"; }
dt() { awk -F'\t' -v k="$1" '$1 == k { print $2; exit }' "$W/doc_totals.tsv"; }

# ---------------------------------------------------------------------------
# 1. Machine
# ---------------------------------------------------------------------------
section_machine() {
  step "1/8 Machine and macOS"
  local ver major ok
  ver=$(sw_vers -productVersion 2>/dev/null)
  mkv computerName "$MACHINE_NAME"
  mkv osName "$(sw_vers -productName 2>/dev/null)"
  mkv osVersion "$ver"
  mkv osBuild "$(sw_vers -buildVersion 2>/dev/null)"
  mkv kernel "$(uname -r 2>/dev/null)"
  if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]; then mkv cpuArch arm64; else mkv cpuArch x86_64; fi
  mkv cpu "$(sysctl -n machdep.cpu.brand_string 2>/dev/null)"
  mkv cpuPhysicalCores "$(sysctl -n hw.physicalcpu 2>/dev/null)" n
  mkv cpuLogicalCores "$(sysctl -n hw.logicalcpu 2>/dev/null)" n
  mkv memoryBytes "$(sysctl -n hw.memsize 2>/dev/null)" n
  mkv modelIdentifier "$(sysctl -n hw.model 2>/dev/null)"
  major=${ver%%.*}
  ok=no
  case "$major" in ''|*[!0-9]*) ok=unknown ;; *) [ "$major" -ge 13 ] && ok=yes ;; esac
  mkv electron44Supported "$ok" b
  if [ "$SKIP_SYSTEM" = 0 ]; then
    if sp_flat SPHardwareDataType > "$W/hw.flat" && [ -s "$W/hw.flat" ]; then
      mkv modelName "$(flat_get "$W/hw.flat" 0/_items/0/machine_name)"
      mkv chip "$(flat_get "$W/hw.flat" 0/_items/0/chip_type)"
      mkv processorName "$(flat_get "$W/hw.flat" 0/_items/0/cpu_type)"
      mkv processorSpeed "$(flat_get "$W/hw.flat" 0/_items/0/current_processor_speed)"
      mkv processorCount "$(flat_get "$W/hw.flat" 0/_items/0/number_processors)"
      mkv memory "$(flat_get "$W/hw.flat" 0/_items/0/physical_memory)"
    else
      err hardware "system_profiler SPHardwareDataType returned nothing"
    fi
  fi
}

# ---------------------------------------------------------------------------
# 2. GPUs and displays
# ---------------------------------------------------------------------------
section_displays() {
  step "2/8 GPUs and displays"
  : > "$W/gpus.tsv"; : > "$W/displays.tsv"; : > "$W/screens.tsv"; : > "$W/displays.txt"
  [ "$SKIP_SYSTEM" = 1 ] && { log "   (skipped)"; return; }
  if sp_flat SPDisplaysDataType > "$W/disp.flat" && [ -s "$W/disp.flat" ]; then
    awk -f "$W/sp_gpus.awk" "$W/disp.flat" > "$W/gpus.tsv"
    awk -f "$W/sp_displays.awk" "$W/disp.flat" > "$W/displays.tsv"
  else
    err displays "system_profiler SPDisplaysDataType returned nothing"
  fi
  system_profiler SPDisplaysDataType 2>/dev/null | grep -v -i -E 'serial' > "$W/displays.txt"
  if osascript -l JavaScript "$W/mac.js" screens > "$W/screens.tsv" 2> "$W/jxa.err"; then
    :
  else
    err screens "Could not read the current display modes: $(head -c 300 "$W/jxa.err")"
    : > "$W/screens.tsv"
  fi
  log "   $(wc -l < "$W/displays.tsv" | tr -d ' ') display(s), $(wc -l < "$W/screens.tsv" | tr -d ' ') active screen(s)"
}

# ---------------------------------------------------------------------------
# 3. Audio and devices
# ---------------------------------------------------------------------------
section_devices() {
  step "3/8 Audio, capture, SDI, MIDI and Stream Deck devices"
  : > "$W/audio.tsv"; : > "$W/devices_raw.tsv"; : > "$W/devices.tsv"; : > "$W/drivers.tsv"; : > "$W/software.tsv"
  [ "$SKIP_SYSTEM" = 1 ] && { log "   (skipped)"; return; }
  local t d f name ver
  if sp_flat SPAudioDataType > "$W/audio.flat"; then
    awk -f "$W/sp_audio.awk" "$W/audio.flat" > "$W/audio.tsv"
  else
    err audio "system_profiler SPAudioDataType failed"
  fi
  for t in SPUSBDataType SPUSBHostDataType SPThunderboltDataType SPPCIDataType SPCameraDataType; do
    sp_flat "$t" | awk -v SRC="$t" -f "$W/sp_devices.awk" >> "$W/devices_raw.tsv"
  done
  awk -f "$W/classify.awk" "$W/devices_raw.tsv" > "$W/devices.tsv"
  for d in /Library/Audio/Plug-Ins/HAL "$HOME/Library/Audio/Plug-Ins/HAL"; do
    [ -d "$d" ] || continue
    for f in "$d"/*; do [ -e "$f" ] && printf 'audio-driver\t%s\t\t\tHAL plug-in\n' "$(basename "$f")" >> "$W/devices.tsv"; done
  done
  for f in "$HOME/Library/Audio/MIDI Configurations"/*.mcfg; do
    [ -f "$f" ] || continue
    plutil -convert xml1 -o - "$f" 2>/dev/null | awk -f "$W/plist.awk" | awk -F'\t' 'tolower($1) ~ /(^|\/)name$/ && $3 != "" { print "midi\t" $3 "\t\t\tAudio MIDI Setup" }' | sort -u >> "$W/devices.tsv"
  done
  {
    if [ -x /usr/bin/kmutil ]; then kmutil showloaded --list-only 2>/dev/null; else kextstat -l 2>/dev/null; fi
    systemextensionsctl list 2>/dev/null
  } | grep -v -i 'com\.apple\.' | grep -o -E '[A-Za-z0-9-]+(\.[A-Za-z0-9_-]+){2,}' | grep -E '[A-Za-z]' | grep -v -E '^[0-9][0-9.-]*$' | sort -u | while IFS= read -r name; do
    printf 'driver\t%s\t\t\tloaded extension\n' "$name" >> "$W/drivers.tsv"
  done
  if [ -d /Library/Extensions ]; then
    for f in /Library/Extensions/*.kext; do [ -e "$f" ] && printf 'driver\t%s\t\t\t/Library/Extensions\n' "$(basename "$f")" >> "$W/drivers.tsv"; done
  fi
  find /Applications "$HOME/Applications" -maxdepth 2 -name '*.app' -prune 2>/dev/null | sort | while IFS= read -r f; do
    name=$(basename "$f" .app)
    case "$(lower "$name")" in
      *propresenter*|*renewed*|*blackmagic*|*desktop\ video*|*davinci*|*atem*|*media\ express*|*ultrastudio*|*aja*|*ndi*|*newtek*|*stream\ deck*|*companion*|*obs*|*vmix*|*wirecast*|*resolume*|*syphon*|*loopback*|*audio\ hijack*|*soundsource*|*blackhole*|*soundflower*|*dante*|*midi*|*touchosc*|*qlab*|*keynote*|*powerpoint*|*vlc*|*ecamm*|*mimolive*|*ableton*|*camtwist*|*elgato*|*magewell*|*epiphan*|*avermedia*|*easyworship*|*openlp*|*freeshow*|*mediashout*|*videohub*|*hyperdeck*)
        ver=$(plutil -convert xml1 -o - "$f/Contents/Info.plist" 2>/dev/null | awk -f "$W/plist.awk" | awk -F'\t' '$1 == "CFBundleShortVersionString" { print $3; exit }')
        printf '%s\t%s\t%s\n' "$name" "$ver" "$f" >> "$W/software.tsv"
        ;;
    esac
  done
  log "   $(wc -l < "$W/audio.tsv" | tr -d ' ') audio device(s), $(grep -c -v '^other' "$W/devices.tsv" | tr -d ' ') notable device(s)"
}

# ---------------------------------------------------------------------------
# 4. ProPresenter installs and preferences
# ---------------------------------------------------------------------------
section_propresenter() {
  step "4/8 ProPresenter installs and preferences"
  : > "$W/pp_installs.tsv"; : > "$W/prefs.tsv"; : > "$W/prefpaths.tsv"; : > "$W/pp_running.txt"; : > "$W/prefs_files.txt"
  local app flat name ver build bid exe arch f
  {
    for app in /Applications/*ProPresenter*.app /Applications/*/*ProPresenter*.app "$HOME"/Applications/*ProPresenter*.app; do
      [ -d "$app" ] && printf '%s\n' "$app"
    done
    if [ "$USE_SPOTLIGHT" = 1 ]; then
      mdfind "kMDItemCFBundleIdentifier == 'com.renewedvision.*'" 2>/dev/null | grep -E '\.app$'
    fi
  } | grep -v -E '/\.Trash/|Backups\.backupdb' | sort -u > "$W/pp_apps.txt"
  while IFS= read -r app; do
    [ -d "$app" ] || continue
    flat="$W/app.flat"
    plutil -convert xml1 -o - "$app/Contents/Info.plist" 2>/dev/null | awk -f "$W/plist.awk" > "$flat"
    name=$(basename "$app" .app)
    ver=$(flat_get "$flat" CFBundleShortVersionString)
    build=$(flat_get "$flat" CFBundleVersion)
    bid=$(flat_get "$flat" CFBundleIdentifier)
    exe=$(flat_get "$flat" CFBundleExecutable)
    arch=""
    [ -n "$exe" ] && arch=$(file -b "$app/Contents/MacOS/$exe" 2>/dev/null | grep -o -E 'x86_64|arm64|i386|ppc' | sort -u | tr '\n' ' ' | sed 's/ $//')
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$ver" "$build" "$bid" "$arch" "$app" >> "$W/pp_installs.tsv"
  done < "$W/pp_apps.txt"
  ps -axo comm= 2>/dev/null | grep -i 'propresenter' | sed 's/^.*\///' | sort -u > "$W/pp_running.txt"

  for f in "$HOME"/Library/Preferences/com.renewedvision.*.plist /Library/Preferences/com.renewedvision.*.plist "$HOME"/Library/Preferences/*[Pp]ro[Pp]resenter*.plist; do
    [ -f "$f" ] && printf '%s\n' "$f"
  done | sort -u > "$W/prefs_files.txt"
  while IFS= read -r f; do
    if ! plutil -convert xml1 -o - "$f" 2>/dev/null | awk -f "$W/plist.awk" | awk -f "$W/lib.awk" -f "$W/prefs.awk" -v PFILE="$f" -v PATHS="$W/prefpaths.tsv" >> "$W/prefs.tsv"; then
      err preferences "Could not read $f"
    fi
  done < "$W/prefs_files.txt"
  log "   $(wc -l < "$W/pp_installs.tsv" | tr -d ' ') install(s), $(wc -l < "$W/prefs_files.txt" | tr -d ' ') preference file(s)"
}

# ---------------------------------------------------------------------------
# 5. Where ProPresenter keeps its data
# ---------------------------------------------------------------------------
kind_of() {
  case "$(lower "$1")" in
    */library/preferences/*) echo configuration ;;
    *playlist*) echo playlists ;;
    *template*|*theme*) echo themes ;;
    *configuration*|*preferences*|*settings*|*stage*|*props*|*messages*|*macros*|*looks*|*timers*|*labels*|*keyboard*) echo configuration ;;
    *media*|*/movies/*|*/pictures/*|*/music/*|*video*|*assets*) echo media ;;
    */application\ support/*) echo app-data ;;
    *) echo library ;;
  esac
}
is_generic_dir() {
  case "$1" in
    "$HOME"|"$HOME/Desktop"|"$HOME/Documents"|"$HOME/Downloads"|"$HOME/Movies"|"$HOME/Pictures"|"$HOME/Music"|/|/Users|/Users/Shared|"$SYS_ROOT/Users/Shared") return 0 ;;
    /Volumes/*/*) return 1 ;;
    /Volumes/*) return 0 ;;
  esac
  return 1
}
excluded_path() {
  case "$1" in
    "$OUT_BASE"/*|"$OUT_DIR"*|*/.Trash/*|*/.Trashes/*|*Backups.backupdb*|*.app/*|*.app|*/Library/Caches/*|/System/*|*-collect/*) return 0 ;;
  esac
  if [ -n "$COLLECT_DEST" ]; then case "$1" in "$COLLECT_DEST"/*) return 0 ;; esac; fi
  return 1
}
add_loc() { printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> "$W/loc_candidates.tsv"; }

section_locations() {
  step "5/8 Finding ProPresenter data (preferences first, then Documents, Application Support and Spotlight)"
  : > "$W/loc_candidates.tsv"; : > "$W/pp_hits.txt"; : > "$W/prefpaths_checked.tsv"
  local p key file d r ext real
  # a) paths named in ProPresenter's own preferences
  while IFS=$'\t' read -r p key file; do
    [ -n "$p" ] || continue
    if [ -d "$p" ]; then
      printf '%s\t%s\tyes\tfolder\n' "$key" "$p" >> "$W/prefpaths_checked.tsv"
      is_generic_dir "$p" || excluded_path "$p" || add_loc "$p" "$(kind_of "$p")" "preferences"
    elif [ -f "$p" ]; then
      printf '%s\t%s\tyes\tfile\n' "$key" "$p" >> "$W/prefpaths_checked.tsv"
      if lower "$p" | grep -q -E "$PP_DOC_RE"; then printf '%s\n' "$p" >> "$W/pp_hits.txt"; fi
    else
      printf '%s\t%s\tno\t\n' "$key" "$p" >> "$W/prefpaths_checked.tsv"
    fi
  done < "$W/prefpaths.tsv"
  while IFS= read -r f; do add_loc "$f" configuration "preferences file"; done < "$W/prefs_files.txt"
  # b) well-known folders
  for d in "$HOME"/Documents/*ProPresenter* "$HOME"/Documents/*Renewed* \
           "$HOME/Library/Application Support/RenewedVision" "$SYS_ROOT/Library/Application Support/RenewedVision" \
           "$HOME"/Library/Application\ Support/*ProPresenter* \
           "$HOME"/Movies/*ProPresenter* "$HOME"/Pictures/*ProPresenter* "$HOME"/Music/*ProPresenter* \
           "$SYS_ROOT"/Users/Shared/*Renewed* "$SYS_ROOT"/Users/Shared/*ProPresenter*; do
    [ -e "$d" ] || continue
    excluded_path "$d" && continue
    add_loc "$d" "$(kind_of "$d")" "default location"
  done
  for r in "${SEARCH_ROOTS[@]}"; do
    [ -n "$r" ] || continue
    if [ -d "$r" ]; then add_loc "$(cd "$r" && pwd -P)" "$(kind_of "$r")" "search root"; else err search-root "Not a folder: $r"; fi
  done
  # c) search for ProPresenter documents
  find "$HOME/Documents" "$HOME/Desktop" "$SYS_ROOT/Users/Shared" -maxdepth 6 -type f 2>/dev/null > "$W/search_all.txt"
  grep -i -E '\.(pro6|pro5|pro4|pro6pl|pro6x|pro6plx|pro6template|probundle|proplaylist)$' "$W/search_all.txt" >> "$W/pp_hits.txt"
  grep -i -E '\.pro$' "$W/search_all.txt" | grep -i -E 'propresenter|renewed ?vision' >> "$W/pp_hits.txt"
  if [ "$USE_SPOTLIGHT" = 1 ]; then
    for ext in pro6 pro5 pro4 pro6pl pro6x pro6plx pro6template probundle proplaylist; do
      mdfind "kMDItemFSName == \"*.$ext\"c" 2>/dev/null
    done >> "$W/pp_hits.txt"
    mdfind "kMDItemFSName == \"*.pro\"c" 2>/dev/null | grep -i -E 'propresenter|renewed ?vision' >> "$W/pp_hits.txt"
  fi
  sort -u "$W/pp_hits.txt" | while IFS= read -r f; do
    [ -f "$f" ] || continue
    excluded_path "$f" && continue
    d=$(dirname "$f")
    if is_generic_dir "$d"; then add_loc "$f" "$(kind_of "$f")" "search (loose file)"; else add_loc "$d" "$(kind_of "$d")" "search"; fi
  done
  # d) normalise, de-duplicate and fold nested folders into their parent
  : > "$W/loc_norm.tsv"
  while IFS=$'\t' read -r p key file; do
    if [ -d "$p" ]; then real=$(cd "$p" 2>/dev/null && pwd -P); else real="$(cd "$(dirname "$p")" 2>/dev/null && pwd -P)/$(basename "$p")"; fi
    [ -n "$real" ] && printf '%s\t%s\t%s\n' "$real" "$key" "$file" >> "$W/loc_norm.tsv"
  done < "$W/loc_candidates.tsv"
  sort -t "$(printf '\t')" -k1,1 "$W/loc_norm.tsv" | awk -F'\t' '
    {
      p = $1
      if (n > 0 && (p == kept[n] || index(p, kept[n] "/") == 1)) { if (index(via[n], $3) == 0) via[n] = via[n] ", " $3; next }
      n++; kept[n] = p; kind[n] = $2; via[n] = $3
    }
    END { for (i = 1; i <= n; i++) print kept[i] "\t" kind[i] "\t" via[i] }' > "$W/locations.tsv"
  log "   $(wc -l < "$W/locations.tsv" | tr -d ' ') location(s)"
}

# ---------------------------------------------------------------------------
# 6. Inventory: file counts and sizes
# ---------------------------------------------------------------------------
section_inventory() {
  step "6/8 Counting files and sizes"
  : > "$W/files.tsv"
  local i=0 p kind via
  while IFS=$'\t' read -r p kind via; do
    i=$((i + 1))
    if [ -d "$p" ]; then
      find "$p" -name '*.app' -prune -o -type f ! -name '.DS_Store' -print0 2>/dev/null | xargs -0 stat -f "$i%t%z%t%N" 2>/dev/null >> "$W/files.tsv"
    elif [ -f "$p" ]; then
      stat -f "$i%t%z%t%N" "$p" 2>/dev/null >> "$W/files.tsv"
    fi
  done < "$W/locations.tsv"
  : > "$W/loc_stats.tsv"; : > "$W/ext_stats.tsv"; : > "$W/loc_subs.tsv"
  awk -F'\t' -v MEDIA="$MEDIA_EXT_RE" '
    NR == FNR { loc[FNR] = $1; kind[FNR] = $2; via[FNR] = $3; nl = FNR; next }
    {
      l = $1; sz = $2 + 0; p = $3
      n[l]++; b[l] += sz
      e = p; sub(/^.*\//, "", e)
      if (index(e, ".") > 1) { sub(/^.*\./, "", e); e = tolower(e) } else e = "(none)"
      if (e ~ MEDIA) { mn[l]++; mb[l] += sz }
      if (!((e) in en)) eo[++ne] = e
      en[e]++; eb[e] += sz
      rel = substr(p, length(loc[l]) + 2)
      top = (index(rel, "/") > 0) ? substr(rel, 1, index(rel, "/") - 1) : "(files at top level)"
      if (!((l, top) in sn)) { so[l] = so[l] "\n" top }
      sn[l, top]++; sb[l, top] += sz
    }
    END {
      for (i = 1; i <= nl; i++) printf "%s\t%s\t%s\t%d\t%.0f\t%d\t%.0f\n", loc[i], kind[i], via[i], n[i], b[i], mn[i], mb[i] > STATS
      for (i = 1; i <= ne; i++) printf "%s\t%d\t%.0f\n", eo[i], en[eo[i]], eb[eo[i]] > EXTS
      for (i = 1; i <= nl; i++) {
        k = split(so[i], tops, "\n")
        for (j = 2; j <= k; j++) printf "%s\t%s\t%d\t%.0f\n", loc[i], tops[j], sn[i, tops[j]], sb[i, tops[j]] > SUBS
      }
    }' STATS="$W/loc_stats.tsv" EXTS="$W/ext_stats.tsv" SUBS="$W/loc_subs.tsv" "$W/locations.tsv" "$W/files.tsv"
  sort -t "$(printf '\t')" -k3,3nr "$W/ext_stats.tsv" -o "$W/ext_stats.tsv"
  log "   $(wc -l < "$W/files.tsv" | tr -d ' ') file(s)"
}

# ---------------------------------------------------------------------------
# 7. Read ProPresenter documents: fonts in slide text, media references
# ---------------------------------------------------------------------------
section_documents() {
  step "8/8 Reading ProPresenter documents (fonts and media references)"
  : > "$W/analysis.tsv"; : > "$W/xml_files.txt"; : > "$W/fonts_declared_only.txt"
  local f magic list total n=0
  awk -F'\t' -v M="$MEDIA_EXT_RE" -v D="$SKIP_EXT_RE" -v BIG="$W/big_files.txt" '{
      p = $3; e = p; sub(/^.*\//, "", e)
      if (index(e, ".") > 1) { sub(/^.*\./, "", e); e = tolower(e) } else e = ""
      if (e != "" && (e ~ M || e ~ D)) next
      if ($2 + 0 > 52428800) { print p >> BIG; next }
      print p
    }' "$W/files.tsv" | sort -u > "$W/ppfiles.txt"
  if [ -s "$W/big_files.txt" ]; then while IFS= read -r f; do err documents "Skipped (over 50 MB): $f"; done < "$W/big_files.txt"; fi
  total=$(wc -l < "$W/ppfiles.txt" | tr -d ' ')
  log "   $total file(s) to read"
  while IFS= read -r f; do
    n=$((n + 1))
    [ $((n % 250)) -eq 0 ] && log "   ... $n / $total"
    magic=$(head -c 4 "$f" 2>/dev/null | od -An -tx1 | tr -d ' \n')
    case "$magic" in
      504b*)
        list=$(unzip -Z1 "$f" 2>/dev/null)
        if printf '%s\n' "$list" | grep -q -i -E '\.(pro6|pro5|pro4|pro6pl)$'; then
          unzip -C -p "$f" '*.pro6' '*.pro5' '*.pro4' '*.pro6pl' 2>/dev/null | awk -v SRCFILE="$f" -f "$W/lib.awk" -f "$W/rtf.awk" -f "$W/ppxml.awk" >> "$W/analysis.tsv"
        fi
        if printf '%s\n' "$list" | grep -q -i -E '\.pro$'; then
          unzip -C -p "$f" '*.pro' 2>/dev/null | od -An -v -tu1 | awk -v SRCFILE="$f" -f "$W/lib.awk" -f "$W/rtf.awk" -f "$W/ppbin.awk" >> "$W/analysis.tsv"
        fi
            ;;
      3c*|efbbbf3c*) printf '%s\0' "$f" >> "$W/xml_files.txt" ;;
      *)
        od -An -v -tu1 "$f" 2>/dev/null | awk -v SRCFILE="$f" -f "$W/lib.awk" -f "$W/rtf.awk" -f "$W/ppbin.awk" >> "$W/analysis.tsv"
        ;;
    esac
  done < "$W/ppfiles.txt"
  if [ -s "$W/xml_files.txt" ]; then
    xargs -0 awk -f "$W/lib.awk" -f "$W/rtf.awk" -f "$W/ppxml.awk" < "$W/xml_files.txt" >> "$W/analysis.tsv"
  fi
  # preference values that point at media files count as references too
  awk -F'\t' -v M="$MEDIA_EXT_RE" '$3 == "yes" && $4 == "file" { e = $2; sub(/^.*\//, "", e); sub(/^.*\./, "", e); if (tolower(e) ~ M) print "MEDIA\t" $2 "\tpreferences: " $1 }' "$W/prefpaths_checked.tsv" >> "$W/analysis.tsv"
  # document totals
  awk -F'\t' '
    function kind(f,  l) {
      l = tolower(f)
      if (l ~ /\.(pro6x|pro6plx|probundle|proplaylist)$/) return "bundles"
      if (l ~ /template|\/themes\//) return "themesAndTemplates"
      if (l ~ /playlist|\.pro6pl$/) return "playlists"
      if (l ~ /\/configuration\/|stagedisplay|messages|clocks|props\.pro6|mask\.pro6|\/preferences\//) return "configuration"
      if (l ~ /\.(pro6|pro5|pro4|pro)$/) return "presentations"
      return "otherFiles"
    }
    $1 == "STAT" { docs++; k[kind($2)]++; if ($3 == "xml") xml++; else pb++; sl += $4; gr += $5; te += $6; pl += $7; mc += $8 }
    END {
      printf "filesRead\t%d\tn\npresentations\t%d\tn\nplaylists\t%d\tn\nthemesAndTemplates\t%d\tn\nconfiguration\t%d\tn\nbundles\t%d\tn\notherFiles\t%d\tn\n", docs, k["presentations"], k["playlists"], k["themesAndTemplates"], k["configuration"], k["bundles"], k["otherFiles"]
      printf "xmlFiles\t%d\tn\nprotobufFiles\t%d\tn\nslidesPP6\t%d\tn\ngroupsPP6\t%d\tn\ntextElements\t%d\tn\nplaylistNodesPP6\t%d\tn\nmediaCuesPP6\t%d\tn\n", xml, pb, sl, gr, te, pl, mc
    }' "$W/analysis.tsv" > "$W/doc_totals.tsv"
  # fonts used in slide text
  awk -F'\t' -v LEG="$LEGACY_FONT_RE" '
    FILENAME == INST { k = tolower($2); inst[k] = 1; ninst++; next }
    FILENAME == NONDEF { m = split($3, nm, "; "); for (i = 1; i <= m; i++) if (nm[i] != "") nd[tolower(nm[i])] = 1; st = $2; sub(/^.*\//, "", st); sub(/\.[^.]*$/, "", st); nd[tolower(st)] = 1; next }
    $1 == "FONT" {
      k = tolower($2); if (!(k in name)) { name[k] = $2; ord[++n] = k }
      occ[k]++; if (!((k, $3) in sf)) { sf[k, $3] = 1; files[k]++ }
      la[k] += $4; gu[k] += $5; hi[k] += $6; ot[k] += $7
      if (index(src[k], $8) == 0) src[k] = src[k] (src[k] == "" ? "" : ",") $8
      u = usedin($3); if (index(use[k], u) == 0) use[k] = use[k] (use[k] == "" ? "" : ", ") u
      next
    }
    $1 == "FONTDECL" { k = tolower($2); if (!(k in dname)) { dname[k] = $2; dord[++dn] = k } }
    function usedin(f,  l) {
      l = tolower(f)
      if (l ~ /template|\/themes\//) return "themes/templates"
      if (l ~ /stage/) return "stage display"
      if (l ~ /\/configuration\/|messages|clocks|props\.pro6|mask\.pro6|\/preferences\//) return "configuration"
      if (l ~ /playlist|\.pro6pl$/) return "playlists"
      return "presentations"
    }
    END {
      for (i = 1; i <= n; i++) {
        k = ord[i]; base = k; sub(/[- ](bold|italic|regular|light|medium|semibold|black|heavy|oblique|bolditalic|bold italic)$/, "", base)
        if (k in nd || base in nd) st = "added font"
        else if (k in inst || base in inst) st = "yes"
        else st = (ninst > 0 ? "NO" : "unknown")
        lg = (k ~ LEG) ? "yes" : "no"
        if (gu[k] > 0 || hi[k] > 0) sc = (gu[k] > 0 ? "Gujarati (Unicode)" : "") ((gu[k] > 0 && hi[k] > 0) ? " + " : "") (hi[k] > 0 ? "Devanagari (Unicode)" : "")
        else if (la[k] + ot[k] > 0) sc = "Latin/other bytes only"
        else sc = "not counted"
        printf "%s\t%d\t%d\t%d\t%d\t%d\t%d\t%s\t%s\t%s\t%s\t%s\n", name[k], occ[k], files[k], la[k], gu[k], hi[k], ot[k], sc, st, lg, src[k], use[k]
      }
      for (i = 1; i <= dn; i++) if (!(dord[i] in name)) printf "%s\n", dname[dord[i]] > DECL
    }' INST="$W/installed_fonts.tsv" NONDEF="$W/fonts_nondefault.tsv" DECL="$W/fonts_declared_only.txt" \
    "$W/installed_fonts.tsv" "$W/fonts_nondefault.tsv" "$W/analysis.tsv" | sort -t "$(printf '\t')" -k2,2nr > "$W/fonts_used.tsv"
  # media and document references, with existence checks
  awk -F'\t' '$1 == "MEDIA" && $2 != "" { k = $2; if (!(k in c)) { ord[++n] = k; first[k] = $3; ap[k] = $4 } c[k]++ }
    END { for (i = 1; i <= n; i++) print ord[i] "\t" c[ord[i]] "\t" first[ord[i]] "\t" ap[ord[i]] }' "$W/analysis.tsv" > "$W/media_refs.tsv"
  awk -F'\t' '$1 == "DOC" && $2 != "" { k = $2; if (!(k in c)) { ord[++n] = k; first[k] = $3 } c[k]++ }
    END { for (i = 1; i <= n; i++) print ord[i] "\t" c[ord[i]] "\t" first[ord[i]] "\t" }' "$W/analysis.tsv" > "$W/doc_refs.tsv"
  check_refs "$W/media_refs.tsv" > "$W/media.tsv"
  check_refs "$W/doc_refs.tsv" > "$W/docrefs.tsv"
  log "   $(wc -l < "$W/fonts_used.tsv" | tr -d ' ') font(s) in slide text, $(wc -l < "$W/media.tsv" | tr -d ' ') media reference(s), $(awk -F'\t' '$2 == "no"' "$W/media.tsv" | wc -l | tr -d ' ') missing"
}

# path, refs, first, approx -> path, exists, reason, refs, first, approx
check_refs() {
  local p c first ap vol
  while IFS=$'\t' read -r p c first ap; do
    if [ -e "$p" ]; then
      printf '%s\tyes\t\t%s\t%s\t%s\n' "$p" "$c" "$first" "$ap"
    else
      case "$p" in
        [A-Za-z]:[\\/]*|\\\\*) printf '%s\tno\tWindows path\t%s\t%s\t%s\n' "$p" "$c" "$first" "$ap" ;;
        /Volumes/*)
          vol=$(printf '%s' "$p" | cut -d/ -f1-3)
          if [ -d "$vol" ]; then printf '%s\tno\tmissing\t%s\t%s\t%s\n' "$p" "$c" "$first" "$ap"
          else printf '%s\tno\tdrive not connected: %s\t%s\t%s\t%s\n' "$p" "${vol#/Volumes/}" "$c" "$first" "$ap"; fi ;;
        *) printf '%s\tno\tmissing\t%s\t%s\t%s\n' "$p" "$c" "$first" "$ap" ;;
      esac
    fi
  done < "$1" | sort -t "$(printf '\t')" -k2,2 -k1,1
}

# ---------------------------------------------------------------------------
# 8. Fonts installed beyond the macOS defaults
# ---------------------------------------------------------------------------
section_fonts() {
  step "7/8 Fonts installed beyond the macOS defaults"
  : > "$W/fonts_nondefault.tsv"; : > "$W/installed_fonts.tsv"
  local d f loc names pkg size
  if osascript -l JavaScript "$W/mac.js" fonts > "$W/installed_fonts.tsv" 2> "$W/jxa.err"; then
    :
  else
    err fonts "Could not list installed fonts: $(head -c 300 "$W/jxa.err")"
    : > "$W/installed_fonts.tsv"
  fi
  for d in "$HOME/Library/Fonts" "/Library/Fonts" "/Network/Library/Fonts"; do
    [ -d "$d" ] || continue
    case "$d" in "$HOME"/*) loc=user ;; *) loc=system ;; esac
    find "$d" -type f ! -name '.DS_Store' ! -name '*.plist' 2>/dev/null | sort | while IFS= read -r f; do
      pkg=""
      if [ "$loc" = system ]; then
        pkg=$(pkgutil --file-info "$f" 2>/dev/null | awk '/^pkgid:/ { print $2; exit }')
        case "$pkg" in com.apple.*) continue ;; esac
      fi
      names=$(mdls -raw -name kMDItemFonts "$f" 2>/dev/null | sed -e 's/^[( ]*//' -e 's/[),]*$//' -e 's/^"//' -e 's/"$//' | grep -v -E '^$|^\(?null\)?$' | tr '\n' ';' | sed -e 's/;/; /g' -e 's/; $//')
      size=$(stat -f %z "$f" 2>/dev/null)
      printf '%s\t%s\t%s\t%s\t%s\n' "$loc" "$f" "$names" "$size" "$pkg" >> "$W/fonts_nondefault.tsv"
    done
  done
  log "   $(wc -l < "$W/fonts_nondefault.tsv" | tr -d ' ') non-default font file(s)"
}

# ---------------------------------------------------------------------------
# Collect (optional): COPY data folders and fonts to the destination
# ---------------------------------------------------------------------------
: > "$W/collect.tsv"
COLLECT_DIR=""
COLLECT_STATUS="not requested"
section_collect() {
  [ -n "$COLLECT_DEST" ] || return 0
  step "Collect: copying ProPresenter data and fonts to $COLLECT_DEST"
  COLLECT_DIR="$COLLECT_DEST/${SAFE_NAME}_${STAMP}-collect"
  local p kind via need avail f dst n1 n2 total=0
  while IFS=$'\t' read -r p kind via; do
    case "$COLLECT_DIR/" in "$p"/*) err collect "The destination is inside $p. Choose another destination."; COLLECT_STATUS="refused"; return 0 ;; esac
  done < "$W/locations.tsv"
  if [ "$NO_MEDIA" = 1 ]; then
    need=$(awk -F'\t' -v M="$MEDIA_EXT_RE" '{ e = $3; sub(/^.*\//, "", e); sub(/^.*\./, "", e); if (tolower(e) !~ M) s += $2 } END { printf "%.0f", s }' "$W/files.tsv")
  else
    need=$(awk -F'\t' '{ s += $2 } END { printf "%.0f", s }' "$W/files.tsv")
  fi
  need=$(awk -v a="$need" -F'\t' '{ a += $4 } END { printf "%.0f", a }' "$W/fonts_nondefault.tsv")
  avail=$(df -k "$COLLECT_DEST" 2>/dev/null | awk 'NR == 2 { printf "%.0f", $4 * 1024 }')
  log "   About $(human "$need") to copy; $(human "${avail:-0}") free on the destination."
  if [ -n "$avail" ] && awk -v n="$need" -v a="$avail" 'BEGIN { exit !(n * 1.05 + 104857600 > a) }'; then
    err collect "Not enough free space on $COLLECT_DEST (need about $(human "$need"), free $(human "$avail")). Try --no-media or a bigger drive."
    COLLECT_STATUS="not enough space"
    return 0
  fi
  if ! mkdir -p "$COLLECT_DIR/data" "$COLLECT_DIR/fonts"; then err collect "Cannot write to $COLLECT_DEST"; COLLECT_STATUS="failed"; return 0; fi
  while IFS=$'\t' read -r p kind via; do
    dst="$COLLECT_DIR/data$p"
    if [ -d "$p" ]; then
      mkdir -p "$dst"
      if [ "$NO_MEDIA" = 1 ]; then
        ( cd "$p" && find . -type f ! -name '.DS_Store' -print 2>/dev/null | awk -v M="$MEDIA_EXT_RE" '{ e = $0; sub(/^.*\//, "", e); if (index(e, ".") > 1) { sub(/^.*\./, "", e); if (tolower(e) ~ M) next } print }' | pax -rw -p p "$dst" ) 2>> "$W/collect.err"
      else
        ditto "$p" "$dst" 2>> "$W/collect.err"
      fi
      n1=$(awk -F'\t' -v l="$p" 'index($3, l "/") == 1' "$W/files.tsv" | wc -l | tr -d ' ')
      n2=$(find "$dst" -type f ! -name '.DS_Store' 2>/dev/null | wc -l | tr -d ' ')
      printf '%s\t%s\t%s\t%s\n' "$p" "$dst" "$n1" "$n2" >> "$W/collect.tsv"
    elif [ -f "$p" ]; then
      mkdir -p "$(dirname "$dst")" && ditto "$p" "$dst" 2>> "$W/collect.err"
      printf '%s\t%s\t1\t%s\n' "$p" "$dst" "$([ -f "$dst" ] && echo 1 || echo 0)" >> "$W/collect.tsv"
    fi
    total=$((total + 1))
  done < "$W/locations.tsv"
  while IFS=$'\t' read -r kind f via n1 n2; do
    mkdir -p "$COLLECT_DIR/fonts/$kind" && ditto "$f" "$COLLECT_DIR/fonts/$kind/$(basename "$f")" 2>> "$W/collect.err"
    printf '%s\t%s\t1\t%s\n' "$f" "$COLLECT_DIR/fonts/$kind/$(basename "$f")" "$([ -f "$COLLECT_DIR/fonts/$kind/$(basename "$f")" ] && echo 1 || echo 0)" >> "$W/collect.tsv"
  done < "$W/fonts_nondefault.tsv"
  if [ -s "$W/collect.err" ]; then err collect "Some files could not be copied: $(head -c 400 "$W/collect.err")"; fi
  cat > "$COLLECT_DIR/READ-ME-FIRST.txt" <<TXT
Drashti audit: collected copies from $MACHINE_NAME ($STAMP)

These are COPIES of ProPresenter data and fonts. Nothing was moved or changed
on the source Mac.

Treat this drive as sensitive. The copies can still contain secrets: licence
or registration details, stream keys, passwords and personal data inside
ProPresenter's preference files and documents. The audit report redacts those;
these raw copies do not.

On the Drashti development Mac, put this folder in migration-samples/ at the
workspace root, which is outside the app/ git repository, and never commit it.
data/   mirrors the original absolute paths.
fonts/  holds font files that are not part of macOS.
TXT
  COLLECT_STATUS="done"
  log "   Copied $total location(s) and $(wc -l < "$W/fonts_nondefault.tsv" | tr -d ' ') font file(s) to $COLLECT_DIR"
}

# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------
write_json() {
  local o="$OUT_DIR/audit.json" roots="" r
  for r in "${SEARCH_ROOTS[@]}"; do roots="$roots${roots:+, }$(jstr "$r")"; done
  {
    printf '{\n'
    printf '  "schema": "%s",\n' "$SCHEMA"
    printf '  "tool": {"name": "audit-mac.sh", "version": "%s"},\n' "$SCRIPT_VERSION"
    printf '  "platform": "macos",\n'
    printf '  "generatedAt": %s,\n' "$(jstr "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
    printf '  "options": {"collect": %s, "noMedia": %s, "spotlight": %s, "skipSystem": %s, "searchRoots": [%s]},\n' \
      "$([ -n "$COLLECT_DEST" ] && jstr "$COLLECT_DEST" || echo null)" "$([ "$NO_MEDIA" = 1 ] && echo true || echo false)" \
      "$([ "$USE_SPOTLIGHT" = 1 ] && echo true || echo false)" "$([ "$SKIP_SYSTEM" = 1 ] && echo true || echo false)" "$roots"
    printf '  "machine": %s,\n' "$(awk -f "$W/lib.awk" -f "$W/kv2json.awk" "$MACHINE_TSV")"
    printf '  "gpus": %s,\n' "$(tsv_json "$W/gpus.tsv" 'index:n,name:s,vendor:S,vram:S,cores:S,metal:S,bus:S')"
    printf '  "displays": %s,\n' "$(tsv_json "$W/displays.tsv" 'gpuIndex:n,name:s,pixels:S,resolution:S,refreshHz:n,main:S,mirror:S,online:S,connection:S,displayType:S,displayId:S')"
    printf '  "activeScreens": %s,\n' "$(tsv_json "$W/screens.tsv" 'displayId:n,name:S,pixelWidth:n,pixelHeight:n,pointWidth:n,pointHeight:n,refreshHz:n,x:n,y:n,scaleFactor:n,main:b,builtIn:b,mirrored:b,rotation:n')"
    printf '  "audioDevices": %s,\n' "$(tsv_json "$W/audio.tsv" 'name:s,manufacturer:S,transport:S,inputChannels:n,outputChannels:n,sampleRate:n,defaultOutput:b,defaultInput:b,defaultSystemOutput:b')"
    printf '  "devices": %s,\n' "$(tsv_json "$W/devices.tsv" 'category:s,name:s,vendor:S,product:S,source:s')"
    printf '  "drivers": %s,\n' "$(tsv_json "$W/drivers.tsv" 'category:s,name:s,vendor:S,product:S,source:s')"
    printf '  "relatedSoftware": %s,\n' "$(tsv_json "$W/software.tsv" 'name:s,version:S,path:s')"
    printf '  "propresenter": {\n'
    printf '    "installs": %s,\n' "$(tsv_json "$W/pp_installs.tsv" 'name:s,version:S,build:S,bundleId:S,architectures:S,path:s')"
    printf '    "running": %s,\n' "$(tsv_json "$W/pp_running.txt" 'process:s')"
    printf '    "preferenceFiles": %s,\n' "$(tsv_json "$W/prefs_files.txt" 'path:s')"
    printf '    "preferences": %s,\n' "$(tsv_json "$W/prefs.tsv" 'file:s,key:s,type:s,value:s')"
    printf '    "preferencePaths": %s,\n' "$(tsv_json "$W/prefpaths_checked.tsv" 'key:s,path:s,exists:b,type:S')"
    printf '    "locations": %s,\n' "$(tsv_json "$W/loc_stats.tsv" 'path:s,kind:s,foundVia:s,fileCount:n,bytes:n,mediaFileCount:n,mediaBytes:n')"
    printf '    "locationSubfolders": %s,\n' "$(tsv_json "$W/loc_subs.tsv" 'location:s,subfolder:s,fileCount:n,bytes:n')"
    printf '    "filesByExtension": %s,\n' "$(tsv_json "$W/ext_stats.tsv" 'extension:s,fileCount:n,bytes:n')"
    printf '    "documents": %s,\n' "$(awk -f "$W/lib.awk" -f "$W/kv2json.awk" "$W/doc_totals.tsv")"
    printf '    "fontsUsedInSlideText": %s,\n' "$(tsv_json "$W/fonts_used.tsv" 'name:s,textElements:n,files:n,latinLetters:n,gujaratiChars:n,devanagariChars:n,otherChars:n,scriptSeen:s,installed:s,knownLegacyFont:b,encodings:s,usedIn:s')"
    printf '    "fontsDeclaredButUnused": %s,\n' "$(tsv_json "$W/fonts_declared_only.txt" 'name:s')"
    printf '    "mediaReferences": %s,\n' "$(tsv_json "$W/media.tsv" 'path:s,exists:b,problem:S,references:n,firstReferencedBy:s,approximate:S')"
    printf '    "documentReferences": %s\n' "$(tsv_json "$W/docrefs.tsv" 'path:s,exists:b,problem:S,references:n,firstReferencedBy:s,approximate:S')"
    printf '  },\n'
    printf '  "fontsBeyondDefaults": %s,\n' "$(tsv_json "$W/fonts_nondefault.tsv" 'location:s,file:s,names:S,bytes:n,installedByPackage:S')"
    printf '  "collect": {"status": %s, "folder": %s, "items": %s},\n' "$(jstr "$COLLECT_STATUS")" "$([ -n "$COLLECT_DIR" ] && jstr "$COLLECT_DIR" || echo null)" "$(tsv_json "$W/collect.tsv" 'source:s,copy:s,sourceFiles:n,copiedFiles:n')"
    printf '  "errors": %s\n' "$(tsv_json "$W/errors.tsv" 'section:s,message:s')"
    printf '}\n'
  } > "$o"
}

write_md() {
  local o="$OUT_DIR/audit-report.md" mem hw_model hw_cpu
  mem=$(mget memoryBytes)
  hw_model=$(mget modelName); [ -n "$hw_model" ] || hw_model=$(mget modelIdentifier)
  hw_cpu=$(mget chip); [ -n "$hw_cpu" ] || hw_cpu=$(mget cpu); [ -n "$hw_cpu" ] || hw_cpu=$(mget processorName)
  {
    printf '# Drashti audit: %s\n\n' "$MACHINE_NAME"
    printf 'Generated %s by audit-mac.sh %s. This audit is read-only: nothing on this Mac was changed. Licence keys, stream keys, passwords and e-mail addresses are redacted.\n\n' "$(date '+%Y-%m-%d %H:%M')" "$SCRIPT_VERSION"
    printf '## Summary\n\n'
    printf -- '- **macOS:** %s %s (%s), %s\n' "$(mget osName)" "$(mget osVersion)" "$(mget osBuild)" "$(mget cpuArch)"
    printf -- '- **Hardware:** %s, %s, %s RAM\n' "$hw_model" "$hw_cpu" "$(human "$mem")"
    case "$(mget electron44Supported)" in
      yes) printf -- '- **Drashti (Electron 44) support:** yes, macOS 13 or later\n' ;;
      no) printf -- '- **Drashti (Electron 44) support:** NO. Electron 44 needs macOS 13 Ventura or later. See the README for options.\n' ;;
      *) printf -- '- **Drashti (Electron 44) support:** unknown\n' ;;
    esac
    printf -- '- **Displays:** %s connected, %s active\n' "$(wc -l < "$W/displays.tsv" | tr -d ' ')" "$(wc -l < "$W/screens.tsv" | tr -d ' ')"
    if [ -s "$W/pp_installs.tsv" ]; then
      printf -- '- **ProPresenter:** %s\n' "$(awk -F'\t' '{ printf "%s%s %s", (NR > 1 ? "; " : ""), $1, $2 }' "$W/pp_installs.tsv")"
    else
      printf -- '- **ProPresenter:** no app found in /Applications\n'
    fi
    printf -- '- **ProPresenter files read:** %s (%s presentations, %s playlists, %s themes/templates, %s text elements)\n' "$(dt filesRead)" "$(dt presentations)" "$(dt playlists)" "$(dt themesAndTemplates)" "$(dt textElements)"
    printf -- '- **Fonts in slide text:** %s (%s known legacy non-Unicode, %s not installed)\n' "$(wc -l < "$W/fonts_used.tsv" | tr -d ' ')" "$(awk -F'\t' '$10 == "yes"' "$W/fonts_used.tsv" | wc -l | tr -d ' ')" "$(awk -F'\t' '$9 == "NO"' "$W/fonts_used.tsv" | wc -l | tr -d ' ')"
    printf -- '- **Media referenced:** %s (%s missing)\n' "$(wc -l < "$W/media.tsv" | tr -d ' ')" "$(awk -F'\t' '$2 == "no"' "$W/media.tsv" | wc -l | tr -d ' ')"
    printf -- '- **Problems during the audit:** %s\n\n' "$(wc -l < "$W/errors.tsv" | tr -d ' ')"

    printf '## Machine\n\n'
    tsv_md "$MACHINE_TSV" 'Item|Value' '1,2'
    printf '\n## GPUs\n\n'
    tsv_md "$W/gpus.tsv" 'GPU|Vendor|VRAM|Cores|Metal|Bus' '2,3,4,5,6,7'
    printf '\n## Displays\n\nActive screens and their current modes (as macOS reports them; position is top-left based):\n\n'
    tsv_md "$W/screens.tsv" 'Display ID|Name|Pixels (W)|Pixels (H)|Refresh Hz|X|Y|Scale|Main|Built-in|Mirrored|Rotation' '1,2,3,4,7,8,9,10,11,12,13,14'
    printf '\nAll connected displays (System Information):\n\n'
    tsv_md "$W/displays.tsv" 'GPU|Name|Pixels|Resolution|Refresh Hz|Main|Mirror|Online|Connection|Type' '1,2,3,4,5,6,7,8,9,10'
    if [ -s "$W/displays.txt" ]; then
      printf '\n<details><summary>Raw display report</summary>\n\n```\n'
      cat "$W/displays.txt"
      printf '```\n\n</details>\n'
    fi
    printf '\n## Audio devices\n\n'
    tsv_md "$W/audio.tsv" 'Device|Manufacturer|Transport|Inputs|Outputs|Sample rate|Default output|Default input|System output' '1,2,3,4,5,6,7,8,9'
    printf '\n## Capture, SDI, MIDI and Stream Deck devices\n\n'
    awk -F'\t' '$1 != "other"' "$W/devices.tsv" > "$W/devices_notable.tsv"
    tsv_md "$W/devices_notable.tsv" 'Category|Name|Vendor|Product|Source' '1,2,3,4,5'
    printf '\nThird-party drivers and extensions:\n\n'
    tsv_md "$W/drivers.tsv" 'Name|Where' '2,5'
    printf '\nAll other USB, Thunderbolt and PCI devices are listed in audit.json.\n'
    printf '\n## Related software\n\n'
    tsv_md "$W/software.tsv" 'App|Version|Path' '1,2,3'
    printf '\n## ProPresenter\n\n### Installs\n\n'
    tsv_md "$W/pp_installs.tsv" 'App|Version|Build|Bundle ID|Architectures|Path' '1,2,3,4,5,6'
    if [ -s "$W/pp_running.txt" ]; then printf '\nRunning during the audit: %s\n' "$(tr '\n' ' ' < "$W/pp_running.txt")"; fi
    printf '\n### Paths named in ProPresenter preferences\n\n'
    tsv_md "$W/prefpaths_checked.tsv" 'Preference key|Path|Exists|Type' '1,2,3,4'
    printf '\n### Preferences about outputs, audio, media and libraries (redacted)\n\n'
    awk -F'\t' 'tolower($2) ~ /output|display|screen|stage|audio|sound|device|resolution|library|librar|media|playlist|theme|template|folder|path|director|shortcut|hotkey|keyboard|midi|remote|network|port|sdi|decklink|ndi|syphon|mask|edge|font|video|live|record|stream/ && $3 != "dict" && $3 != "array" { print $0 }' "$W/prefs.tsv" > "$W/prefs_interesting.tsv"
    tsv_md "$W/prefs_interesting.tsv" 'File|Key|Type|Value' '1,2,3,4' 400
    printf '\nEvery preference value (redacted) is in audit.json.\n'
    printf '\n### Data locations\n\n'
    awk -F'\t' '{ printf "%s\t%s\t%s\t%s\t%s\t%s\n", $2, $1, $4, hb($5), $6, $3 } function hb(b,  u, i) { split("B KB MB GB TB", u, " "); i = 1; while (b >= 1024 && i < 5) { b /= 1024; i++ } return (i == 1) ? sprintf("%d %s", b, u[i]) : sprintf("%.1f %s", b, u[i]) }' "$W/loc_stats.tsv" > "$W/loc_md.tsv"
    tsv_md "$W/loc_md.tsv" 'Kind|Path|Files|Size|Media files|Found via' '1,2,3,4,5,6'
    printf '\nSub-folders:\n\n'
    awk -F'\t' '{ printf "%s\t%s\t%s\t%s\n", $1, $2, $3, hb($4) } function hb(b,  u, i) { split("B KB MB GB TB", u, " "); i = 1; while (b >= 1024 && i < 5) { b /= 1024; i++ } return (i == 1) ? sprintf("%d %s", b, u[i]) : sprintf("%.1f %s", b, u[i]) }' "$W/loc_subs.tsv" > "$W/subs_md.tsv"
    tsv_md "$W/subs_md.tsv" 'Location|Sub-folder|Files|Size' '1,2,3,4' 300
    printf '\n### Files by type\n\n'
    awk -F'\t' '{ printf "%s\t%s\t%s\n", $1, $2, hb($3) } function hb(b,  u, i) { split("B KB MB GB TB", u, " "); i = 1; while (b >= 1024 && i < 5) { b /= 1024; i++ } return (i == 1) ? sprintf("%d %s", b, u[i]) : sprintf("%.1f %s", b, u[i]) }' "$W/ext_stats.tsv" > "$W/ext_md.tsv"
    tsv_md "$W/ext_md.tsv" 'Extension|Files|Size' '1,2,3' 60
    printf '\n### Documents\n\n'
    tsv_md "$W/doc_totals.tsv" 'Item|Count' '1,2'
    printf '\n### Fonts used in slide text\n\n'
    printf 'Counts come from the RTF inside each text element. "Gujarati (Unicode)" or "Devanagari (Unicode)" means real Unicode text was seen in that font. A Gujarati or Hindi font with "Latin/other bytes only" is probably a legacy (non-Unicode) font that the importer must convert.\n\n'
    tsv_md "$W/fonts_used.tsv" 'Font|Text elements|Files|Used in|Latin letters|Gujarati chars|Devanagari chars|Other chars|Script seen|Installed|Known legacy font' '1,2,3,12,4,5,6,7,8,9,10'
    if [ -s "$W/fonts_declared_only.txt" ]; then printf '\nDeclared in font tables but with no text: %s\n' "$(tr '\n' ',' < "$W/fonts_declared_only.txt" | sed 's/,$//; s/,/, /g')"; fi
    printf '\n### Media referenced by ProPresenter documents\n\n'
    printf '%s references to %s files; %s missing.\n\n' "$(awk -F'\t' '{ s += $4 } END { print s + 0 }' "$W/media.tsv")" "$(wc -l < "$W/media.tsv" | tr -d ' ')" "$(awk -F'\t' '$2 == "no"' "$W/media.tsv" | wc -l | tr -d ' ')"
    awk -F'\t' '$2 == "no"' "$W/media.tsv" > "$W/media_missing.tsv"
    printf 'Missing files:\n\n'
    tsv_md "$W/media_missing.tsv" 'Path|Problem|References|First referenced by' '1,3,4,5' 300
    printf '\n### Presentations referenced by playlists\n\n'
    printf '%s referenced; %s missing.\n\n' "$(wc -l < "$W/docrefs.tsv" | tr -d ' ')" "$(awk -F'\t' '$2 == "no"' "$W/docrefs.tsv" | wc -l | tr -d ' ')"
    awk -F'\t' '$2 == "no"' "$W/docrefs.tsv" > "$W/docrefs_missing.tsv"
    tsv_md "$W/docrefs_missing.tsv" 'Missing path|Problem|References|First referenced by' '1,3,4,5' 200
    printf '\n## Fonts installed beyond the macOS defaults\n\n'
    tsv_md "$W/fonts_nondefault.tsv" 'Where|File|Font names|Bytes|Installer package' '1,2,3,4,5'
    printf '\n## Collect\n\n'
    printf 'Status: %s\n\n' "$COLLECT_STATUS"
    if [ -s "$W/collect.tsv" ]; then
      printf 'Folder: `%s`\n\n' "$COLLECT_DIR"
      tsv_md "$W/collect.tsv" 'Source|Copy|Source files|Copied files' '1,2,3,4'
      printf '\n**Treat the collected copies as sensitive.** They are raw copies and can still contain licence details, stream keys and passwords.\n'
    fi
    printf '\n## Problems during the audit\n\n'
    tsv_md "$W/errors.tsv" 'Section|Message' '1,2'
    printf '\n---\nNext: fill in SETUP-CHECKLIST.md and send this folder (audit-report.md and audit.json) to the Drashti developer.\n'
  } > "$o"
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
log "Drashti audit $SCRIPT_VERSION (read-only) on $MACHINE_NAME"
log "Report folder: $OUT_DIR"
T0=$(date +%s)
section_machine
section_displays
section_devices
section_propresenter
section_locations
section_inventory
section_fonts
section_documents
section_collect
step "Writing the report"
write_json
write_md
if [ "$SKIP_SYSTEM" = 0 ]; then
  if ! osascript -l JavaScript "$W/mac.js" checkjson "$OUT_DIR/audit.json" > /dev/null 2>&1; then
    log "   ! audit.json did not pass a JSON check; please send it anyway."
  fi
fi
if [ -n "$COLLECT_DIR" ] && [ -d "$COLLECT_DIR" ]; then
  mkdir -p "$COLLECT_DIR/audit" && ditto "$OUT_DIR" "$COLLECT_DIR/audit/$(basename "$OUT_DIR")" 2>/dev/null
fi
log ""
log "Done in $(( $(date +%s) - T0 ))s."
log "Report: $OUT_DIR/audit-report.md"
log "Data:   $OUT_DIR/audit.json"
[ -n "$COLLECT_DIR" ] && log "Copies: $COLLECT_DIR (treat as sensitive)"
exit 0
