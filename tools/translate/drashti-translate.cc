// drashti-translate: Drashti's offline translation helper (IndicTrans2 through CTranslate2 + SentencePiece).
//
// One JSON object per line on stdin, one JSON object per line on stdout; stderr carries no text from requests.
// The helper only tokenises (SentencePiece, the model's source model) and translates (CTranslate2); the
// IndicTrans2 pre- and post-processing (normalisation, script conversion, placeholders, detokenising) is
// done by the caller, which also decodes the output tokens.
//
// Requests (every field bounded; anything else is refused):
//   {"id":1,"op":"load","route":"en-indic","model":"<dir>","spm":"<file>","threads":2}
//   {"id":2,"op":"translate","route":"en-indic","src":"eng_Latn","tgt":"guj_Gujr","text":"...","beam":1}
//   {"id":3,"op":"cancel"}          stops the translation in flight (greedy: at the next token)
//   {"id":6,"op":"pieces","route":"en-indic","text":"..."}   the source model's pieces only (for parity checks)
//   {"id":4,"op":"unload","route":"en-indic"}
//   {"id":5,"op":"quit"}
// Replies: {"id":N,"ok":true,...} or {"id":N,"ok":false,"error":"<code>"}; the first line is
//   {"hello":"drashti-translate","protocol":1,"ctranslate2":"4.9.1","sentencepiece":"0.2.1"}.
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <deque>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include <ctranslate2/translator.h>
#include <sentencepiece_processor.h>

#if defined(__APPLE__) && defined(__x86_64__)
#include <sys/sysctl.h>
#endif

#ifdef _WIN32
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <share.h>
#include <windows.h>
#endif

namespace {

constexpr int kProtocol = 1;
constexpr size_t kMaxLine = 64 * 1024;
constexpr size_t kMaxSourceTokens = 256;  // x74's validated length; never truncated silently
constexpr size_t kMaxDecodingLength = 256;

// ---- A small, strict JSON reader for one flat object of strings, numbers and booleans. ----
struct Value {
  enum class Kind { String, Number, Bool } kind;
  std::string s;
  double n = 0;
  bool b = false;
};
using Object = std::map<std::string, Value>;

class Reader {
public:
  explicit Reader(const std::string& text) : t_(text) {}
  bool object(Object& out) {
    ws();
    if (!eat('{')) return false;
    ws();
    if (eat('}')) return end();
    for (;;) {
      std::string key;
      ws();
      if (!string(key)) return false;
      ws();
      if (!eat(':')) return false;
      ws();
      Value v;
      if (peek() == '"') {
        v.kind = Value::Kind::String;
        if (!string(v.s)) return false;
      } else if (t_.compare(i_, 4, "true") == 0) {
        v.kind = Value::Kind::Bool, v.b = true, i_ += 4;
      } else if (t_.compare(i_, 5, "false") == 0) {
        v.kind = Value::Kind::Bool, v.b = false, i_ += 5;
      } else {
        v.kind = Value::Kind::Number;
        if (!number(v.n)) return false;
      }
      if (out.count(key)) return false;  // duplicate keys refused
      out.emplace(std::move(key), std::move(v));
      ws();
      if (eat(',')) continue;
      if (eat('}')) return end();
      return false;
    }
  }

private:
  const std::string& t_;
  size_t i_ = 0;
  char peek() const { return i_ < t_.size() ? t_[i_] : '\0'; }
  bool eat(char c) {
    if (peek() != c) return false;
    ++i_;
    return true;
  }
  void ws() {
    while (i_ < t_.size() && (t_[i_] == ' ' || t_[i_] == '\t' || t_[i_] == '\r' || t_[i_] == '\n')) ++i_;
  }
  bool end() {
    ws();
    return i_ == t_.size();
  }
  static void utf8(std::string& out, uint32_t cp) {
    if (cp < 0x80) {
      out += static_cast<char>(cp);
    } else if (cp < 0x800) {
      out += static_cast<char>(0xC0 | (cp >> 6));
      out += static_cast<char>(0x80 | (cp & 0x3F));
    } else if (cp < 0x10000) {
      out += static_cast<char>(0xE0 | (cp >> 12));
      out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
      out += static_cast<char>(0x80 | (cp & 0x3F));
    } else {
      out += static_cast<char>(0xF0 | (cp >> 18));
      out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
      out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
      out += static_cast<char>(0x80 | (cp & 0x3F));
    }
  }
  bool hex4(uint32_t& v) {
    if (i_ + 4 > t_.size()) return false;
    v = 0;
    for (int k = 0; k < 4; ++k) {
      const char c = t_[i_++];
      v <<= 4;
      if (c >= '0' && c <= '9') v |= c - '0';
      else if (c >= 'a' && c <= 'f') v |= c - 'a' + 10;
      else if (c >= 'A' && c <= 'F') v |= c - 'A' + 10;
      else return false;
    }
    return true;
  }
  bool string(std::string& out) {
    if (!eat('"')) return false;
    while (i_ < t_.size()) {
      const unsigned char c = static_cast<unsigned char>(t_[i_++]);
      if (c == '"') return true;
      if (c < 0x20) return false;
      if (c != '\\') {
        out += static_cast<char>(c);
        continue;
      }
      if (i_ >= t_.size()) return false;
      const char e = t_[i_++];
      switch (e) {
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'u': {
          uint32_t cp = 0;
          if (!hex4(cp)) return false;
          if (cp >= 0xD800 && cp <= 0xDBFF) {
            uint32_t lo = 0;
            if (!eat('\\') || !eat('u') || !hex4(lo) || lo < 0xDC00 || lo > 0xDFFF) return false;
            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
          } else if (cp >= 0xDC00 && cp <= 0xDFFF) {
            return false;
          }
          utf8(out, cp);
          break;
        }
        default: return false;
      }
    }
    return false;
  }
  bool number(double& out) {
    const size_t start = i_;
    if (peek() == '-') ++i_;
    while (i_ < t_.size() && ((t_[i_] >= '0' && t_[i_] <= '9') || t_[i_] == '.' || t_[i_] == 'e' ||
                              t_[i_] == 'E' || t_[i_] == '+' || t_[i_] == '-'))
      ++i_;
    if (i_ == start) return false;
    try {
      size_t used = 0;
      out = std::stod(t_.substr(start, i_ - start), &used);
      return used == i_ - start;
    } catch (...) {
      return false;
    }
  }
};

void quote(std::string& out, const std::string& s) {
  out += '"';
  for (const unsigned char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof buf, "\\u%04x", c);
          out += buf;
        } else {
          out += static_cast<char>(c);
        }
    }
  }
  out += '"';
}

std::mutex out_mutex;
void reply(const std::string& line) {
  std::lock_guard<std::mutex> lock(out_mutex);
  std::fwrite(line.data(), 1, line.size(), stdout);
  std::fputc('\n', stdout);
  std::fflush(stdout);
}
std::string id_part(const Object& o) {
  const auto it = o.find("id");
  if (it == o.end() || it->second.kind != Value::Kind::Number) return "\"id\":null";
  char buf[32];
  std::snprintf(buf, sizeof buf, "\"id\":%.0f", it->second.n);
  return buf;
}
void fail(const Object& o, const char* code) {
  reply("{" + id_part(o) + ",\"ok\":false,\"error\":\"" + code + "\"}");
}
const std::string* str(const Object& o, const char* key, size_t max) {
  const auto it = o.find(key);
  if (it == o.end() || it->second.kind != Value::Kind::String || it->second.s.size() > max) return nullptr;
  return &it->second.s;
}
std::optional<long> integer(const Object& o, const char* key, long lo, long hi) {
  const auto it = o.find(key);
  if (it == o.end() || it->second.kind != Value::Kind::Number) return std::nullopt;
  const double v = it->second.n;
  // In range and whole first: converting an out-of-range double (1e300, NaN) to long is undefined behaviour.
  if (!(v >= static_cast<double>(lo) && v <= static_cast<double>(hi)) || v != std::floor(v)) return std::nullopt;
  return static_cast<long>(v);
}
bool is_language_tag(const std::string& tag) {
  static const char* tags[] = {"eng_Latn", "guj_Gujr", "hin_Deva"};
  for (const char* t : tags)
    if (tag == t) return true;
  return false;
}
bool is_route(const std::string& r) { return r == "en-indic" || r == "indic-en" || r == "indic-indic"; }

// The Intel Mac program run by Rosetta on Apple silicon: ruy's cache query crashes there at the first matrix
// product (seen 24 Nov 2026), so it loads nothing and says why. The Apple silicon program is for those Macs.
bool under_rosetta() {
#if defined(__APPLE__) && defined(__x86_64__)
  int translated = 0;
  size_t size = sizeof translated;
  return sysctlbyname("sysctl.proc_translated", &translated, &size, nullptr, 0) == 0 && translated == 1;
#else
  return false;
#endif
}

// A whole file by its UTF-8 path, at most `max` bytes. On Windows through the wide path (as CTranslate2 opens its own
// files): SentencePiece's own Load opens a narrow one, which a user name outside the ANSI code page breaks.
bool read_file(const std::string& path, std::string& out, size_t max) {
#ifdef _WIN32
  const int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path.c_str(), -1, nullptr, 0);
  if (count <= 0) return false;
  std::wstring wide(static_cast<size_t>(count), L'\0');
  if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path.c_str(), -1, &wide[0], count) != count) return false;
  // _wfsopen, not _wfopen (deprecated by MSVC: C4996): shared as _wfopen shares it.
  FILE* file = _wfsopen(wide.c_str(), L"rb", _SH_DENYNO);
#else
  FILE* file = std::fopen(path.c_str(), "rb");
#endif
  if (!file) return false;
  out.clear();
  char buffer[65536];
  size_t got = 0;
  bool ok = true;
  while ((got = std::fread(buffer, 1, sizeof buffer, file)) > 0) {
    out.append(buffer, got);
    if (out.size() > max) {
      ok = false;
      break;
    }
  }
  if (std::ferror(file)) ok = false;
  std::fclose(file);
  return ok;
}

constexpr size_t kMaxTokenizerModel = 64 * 1024 * 1024;

struct Route {
  std::unique_ptr<ctranslate2::Translator> translator;
  sentencepiece::SentencePieceProcessor spm;
};

std::map<std::string, std::unique_ptr<Route>> routes;
std::atomic<bool> cancel_requested{false};
std::atomic<bool> busy{false};

void load(const Object& o) {
  const std::string* route = str(o, "route", 32);
  const std::string* model = str(o, "model", 4096);
  const std::string* spm = str(o, "spm", 4096);
  const auto threads = integer(o, "threads", 1, 16);
  // An empty path is refused: SentencePiece would read standard input, the helper's own requests.
  if (!route || !is_route(*route) || !model || model->empty() || !spm || spm->empty() || !threads)
    return fail(o, "bad-request");
  if (under_rosetta()) return fail(o, "translated");
  const auto started = std::chrono::steady_clock::now();
  auto r = std::make_unique<Route>();
  std::string proto;
  if (!read_file(*spm, proto, kMaxTokenizerModel) || !r->spm.LoadFromSerializedProto(proto).ok())
    return fail(o, "tokenizer-unreadable");
  try {
    ctranslate2::models::ModelLoader loader(*model);
    loader.device = ctranslate2::Device::CPU;
    loader.compute_type = ctranslate2::ComputeType::INT8;
    loader.num_replicas_per_device = 1;
    ctranslate2::ReplicaPoolConfig config;
    config.num_threads_per_replica = static_cast<size_t>(*threads);
    config.max_queued_batches = 0;
    r->translator = std::make_unique<ctranslate2::Translator>(loader, config);
  } catch (const std::exception&) {
    return fail(o, "model-unreadable");
  }
  routes.insert_or_assign(*route, std::move(r));
  const long long ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                      std::chrono::steady_clock::now() - started)
                      .count();
  reply("{" + id_part(o) + ",\"ok\":true,\"route\":\"" + *route + "\",\"loadMs\":" + std::to_string(ms) +
        "}");
}

void translate(const Object& o) {
  const std::string* route = str(o, "route", 32);
  const std::string* src = str(o, "src", 16);
  const std::string* tgt = str(o, "tgt", 16);
  const std::string* text = str(o, "text", kMaxLine);
  const auto beam = integer(o, "beam", 1, 8);
  if (!route || !src || !tgt || !text || !beam || !is_language_tag(*src) || !is_language_tag(*tgt))
    return fail(o, "bad-request");
  const auto found = routes.find(*route);
  if (found == routes.end()) return fail(o, "not-loaded");
  Route& r = *found->second;
  const auto started = std::chrono::steady_clock::now();
  // As IndicTransTokenizer: the two language tags, the source model's pieces, then the end token.
  std::vector<std::string> pieces;
  if (!r.spm.Encode(*text, &pieces).ok()) return fail(o, "tokenizer-failed");
  std::vector<std::string> source;
  source.reserve(pieces.size() + 3);
  source.push_back(*src);
  source.push_back(*tgt);
  source.insert(source.end(), pieces.begin(), pieces.end());
  source.push_back("</s>");
  if (source.size() > kMaxSourceTokens) return fail(o, "too-long");
  ctranslate2::TranslationOptions options;
  options.beam_size = static_cast<size_t>(*beam);
  options.max_input_length = 0;
  options.max_decoding_length = kMaxDecodingLength;
  options.return_end_token = true;
  if (*beam == 1) options.callback = [](ctranslate2::GenerationStepResult) { return cancel_requested.load(); };
  std::vector<std::string> tokens;
  try {
    const auto results = r.translator->translate_batch({source}, options);
    tokens = results.at(0).hypotheses.at(0);
  } catch (const std::exception&) {
    return fail(o, "translate-failed");
  }
  if (cancel_requested.load()) return fail(o, "cancelled");
  const long long ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                      std::chrono::steady_clock::now() - started)
                      .count();
  std::string out = "{" + id_part(o) + ",\"ok\":true,\"sourceTokens\":" + std::to_string(source.size()) +
                    ",\"ms\":" + std::to_string(ms) + ",\"tokens\":[";
  for (size_t i = 0; i < tokens.size(); ++i) {
    if (i) out += ',';
    quote(out, tokens[i]);
  }
  out += "]}";
  reply(out);
}

void pieces(const Object& o) {
  const std::string* route = str(o, "route", 32);
  const std::string* text = str(o, "text", kMaxLine);
  if (!route || !text) return fail(o, "bad-request");
  const auto found = routes.find(*route);
  if (found == routes.end()) return fail(o, "not-loaded");
  std::vector<std::string> out;
  if (!found->second->spm.Encode(*text, &out).ok()) return fail(o, "tokenizer-failed");
  std::string line = "{" + id_part(o) + ",\"ok\":true,\"tokens\":[";
  for (size_t i = 0; i < out.size(); ++i) {
    if (i) line += ',';
    quote(line, out[i]);
  }
  line += "]}";
  reply(line);
}

std::mutex queue_mutex;
std::condition_variable queue_ready;
std::deque<Object> queue;
bool input_closed = false;

void read_input() {
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.size() > kMaxLine) {
      reply("{\"id\":null,\"ok\":false,\"error\":\"too-large\"}");
      continue;
    }
    Object o;
    if (!Reader(line).object(o)) {
      reply("{\"id\":null,\"ok\":false,\"error\":\"bad-json\"}");
      continue;
    }
    const std::string* op = str(o, "op", 16);
    if (op && *op == "cancel") {
      // Only a translation in flight is stopped; nothing queued survives a cancel either.
      cancel_requested = busy.load();
      {
        std::lock_guard<std::mutex> lock(queue_mutex);
        for (const Object& q : queue) fail(q, "cancelled");
        queue.clear();
      }
      reply("{" + id_part(o) + ",\"ok\":true}");
      continue;
    }
    std::lock_guard<std::mutex> lock(queue_mutex);
    queue.push_back(std::move(o));
    queue_ready.notify_one();
  }
  std::lock_guard<std::mutex> lock(queue_mutex);
  input_closed = true;
  queue_ready.notify_one();
}

}  // namespace

int main() {
  std::ios::sync_with_stdio(false);
  reply(std::string("{\"hello\":\"drashti-translate\",\"protocol\":") + std::to_string(kProtocol) +
        ",\"ctranslate2\":\"4.9.1\",\"sentencepiece\":\"0.2.1\"}");
  std::thread reader(read_input);
  reader.detach();
  for (;;) {
    Object o;
    {
      std::unique_lock<std::mutex> lock(queue_mutex);
      queue_ready.wait(lock, [] { return !queue.empty() || input_closed; });
      if (queue.empty()) break;
      o = std::move(queue.front());
      queue.pop_front();
      cancel_requested = false;
      busy = true;
    }
    const std::string* op = str(o, "op", 16);
    if (!op) fail(o, "bad-request");
    else if (*op == "load") load(o);
    else if (*op == "translate") translate(o);
    else if (*op == "pieces") pieces(o);
    else if (*op == "unload") {
      const std::string* route = str(o, "route", 32);
      if (!route || !routes.erase(*route)) fail(o, "not-loaded");
      else reply("{" + id_part(o) + ",\"ok\":true}");
    } else if (*op == "quit") {
      reply("{" + id_part(o) + ",\"ok\":true}");
      busy = false;
      break;
    } else {
      fail(o, "unknown-op");
    }
    busy = false;
  }
  routes.clear();
  std::fflush(stdout);
  std::_Exit(0);
}
