/*
 * drashti-whisper: Drashti's live captions engine on a Mac (Session 55, Part 10).
 *
 * A small program on whisper.cpp's prebuilt library (whisper.framework from whisper.cpp's own release, MIT) that
 * answers as whisper.cpp's whisper-server does (the program Drashti runs on Windows), for what Drashti asks:
 *   GET  /health     200 {"status":"ok"} (the model is loaded before it listens)
 *   POST /inference  multipart/form-data: file (a 16 kHz mono 16-bit WAV), language ("auto" or a code),
 *                    temperature, temperature_inc, no_language_probabilities; the reply is whisper-server's
 *                    verbose_json: language, language_probabilities, segments with their words (tokens).
 * It listens on 127.0.0.1 only, one request at a time, and writes nothing it hears anywhere (no log, no file).
 * Both routes need a private --request-path prefix chosen by Drashti for this process.
 * Built by scripts/fetch-whisper.mjs with the Mac's own clang, against the framework beside it.
 */
#include <whisper/whisper.h>

#include <netinet/in.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

#define MAX_HEAD 16384
#define MAX_BODY (64 * 1024 * 1024)

static struct whisper_context *ctx;
static int threads = 4;
static char health_request[64], inference_request[64];
static const char usage[] =
    "Usage: drashti-whisper -m MODEL --host 127.0.0.1 --port PORT --request-path PATH [-t THREADS] [-ng]\n";

/* ---- a growing buffer for the reply ---- */
typedef struct {
  char *s;
  size_t n, cap;
} buf;

static void put(buf *b, const char *s, size_t n) {
  if (b->n + n + 1 > b->cap) {
    size_t cap = b->cap ? b->cap : 4096;
    while (cap < b->n + n + 1) cap *= 2;
    char *t = realloc(b->s, cap);
    if (!t) abort();
    b->s = t;
    b->cap = cap;
  }
  memcpy(b->s + b->n, s, n);
  b->n += n;
  b->s[b->n] = 0;
}
static void puts_(buf *b, const char *s) { put(b, s, strlen(s)); }
static void putnum(buf *b, double v) {
  char t[64];
  int n = snprintf(t, sizeof t, "%.4f", v);
  if (n > 0) put(b, t, (size_t)n);
}

/* A JSON string of UTF-8 text; bytes that are not UTF-8 become U+FFFD, as whisper-server's own replacing does. */
static void put_json_string(buf *b, const char *s) {
  puts_(b, "\"");
  const unsigned char *p = (const unsigned char *)(s ? s : "");
  while (*p) {
    unsigned char c = *p;
    if (c == '"' || c == '\\') {
      char e[2] = {'\\', (char)c};
      put(b, e, 2);
      p++;
    } else if (c < 0x20) {
      char e[8];
      snprintf(e, sizeof e, "\\u%04x", c);
      put(b, e, 6);
      p++;
    } else if (c < 0x80) {
      put(b, (const char *)p, 1);
      p++;
    } else {
      int len = (c & 0xE0) == 0xC0 ? 2 : (c & 0xF0) == 0xE0 ? 3 : (c & 0xF8) == 0xF0 ? 4 : 0;
      bool ok = len > 0;
      for (int i = 1; ok && i < len; i++)
        if ((p[i] & 0xC0) != 0x80) ok = false; /* stops at the NUL too, never past it */
      if (ok) {
        put(b, (const char *)p, (size_t)len);
        p += len;
      } else {
        put(b, "\xEF\xBF\xBD", 3);
        p++;
      }
    }
  }
  puts_(b, "\"");
}

/* How many bytes the last letter of s still needs (a token can end inside a letter; the next one finishes it). */
static int trailing_needed(const char *s) {
  size_t n = strlen(s);
  for (size_t back = 1; back <= 4 && back <= n; back++) {
    unsigned char c = (unsigned char)s[n - back];
    if ((c & 0xC0) == 0x80) continue;
    int len = (c & 0x80) == 0 ? 1 : (c & 0xE0) == 0xC0 ? 2 : (c & 0xF0) == 0xE0 ? 3 : (c & 0xF8) == 0xF0 ? 4 : 1;
    return len > (int)back ? len - (int)back : 0;
  }
  return 0;
}

/* ---- the connection ---- */
static void write_all(int fd, const char *s, size_t n) {
  while (n > 0) {
    ssize_t w = write(fd, s, n);
    if (w <= 0) return;
    s += w;
    n -= (size_t)w;
  }
}

static void reply(int fd, int status, const char *body) {
  const char *text = status == 200 ? "OK" : status == 400 ? "Bad Request" : status == 404 ? "Not Found"
                     : status == 413 ? "Payload Too Large" : "Internal Server Error";
  char head[256];
  size_t n = strlen(body);
  int h = snprintf(head, sizeof head,
                   "HTTP/1.1 %d %s\r\nContent-Type: application/json\r\nContent-Length: %zu\r\nConnection: close\r\n\r\n",
                   status, text, n);
  if (h > 0) write_all(fd, head, (size_t)h);
  write_all(fd, body, n);
}

/* A header's value (case-insensitive name), copied into out; false when there is none. */
static bool header(const char *head, const char *name, char *out, size_t cap) {
  size_t len = strlen(name);
  for (const char *line = strstr(head, "\r\n"); line; line = strstr(line + 2, "\r\n")) {
    const char *at = line + 2;
    if (strncasecmp(at, name, len) == 0 && at[len] == ':') {
      at += len + 1;
      while (*at == ' ' || *at == '\t') at++;
      size_t i = 0;
      while (at[i] && at[i] != '\r' && i + 1 < cap) {
        out[i] = at[i];
        i++;
      }
      out[i] = 0;
      return true;
    }
  }
  return false;
}

/* One part of the form: its name and its bytes. */
typedef struct {
  char name[64];
  const char *data;
  size_t size;
} part;

/* The form's parts (at most 16), by the boundary. */
static int parts_of(const char *body, size_t size, const char *boundary, part *out, int max) {
  char mark[256];
  int m = snprintf(mark, sizeof mark, "--%s", boundary);
  if (m <= 2 || (size_t)m >= sizeof mark) return 0;
  int count = 0;
  const char *at = memmem(body, size, mark, (size_t)m);
  while (at && count < max) {
    const char *start = at + m;
    size_t left = size - (size_t)(start - body);
    if (left >= 2 && start[0] == '-' && start[1] == '-') break; /* the end */
    const char *head_end = memmem(start, left, "\r\n\r\n", 4);
    if (!head_end) break;
    const char *data = head_end + 4;
    const char *next = memmem(data, size - (size_t)(data - body), mark, (size_t)m);
    if (!next || next - data < 2) break;
    part *p = &out[count];
    p->name[0] = 0;
    const char *name = memmem(start, (size_t)(head_end - start), "name=\"", 6);
    if (name) {
      name += 6;
      size_t i = 0;
      while (name < head_end && *name != '"' && i + 1 < sizeof p->name) p->name[i++] = *name++;
      p->name[i] = 0;
    }
    p->data = data;
    p->size = (size_t)(next - data) - 2; /* the \r\n before the next mark */
    count++;
    at = next;
  }
  return count;
}

static const part *field(const part *ps, int n, const char *name) {
  for (int i = 0; i < n; i++)
    if (strcmp(ps[i].name, name) == 0) return &ps[i];
  return NULL;
}

/* A short field as text (at most cap - 1 bytes). */
static void text_of(const part *p, char *out, size_t cap) {
  size_t n = p && p->size < cap ? p->size : (p ? cap - 1 : 0);
  if (p) memcpy(out, p->data, n);
  out[n] = 0;
}

/* The samples of a 16 kHz mono 16-bit WAV, as floats; NULL for any other. */
static float *samples_of(const unsigned char *wav, size_t size, int *count) {
  if (size < 12 || memcmp(wav, "RIFF", 4) != 0 || memcmp(wav + 8, "WAVE", 4) != 0) return NULL;
  bool fmt_ok = false;
  size_t at = 12;
  while (at + 8 <= size) {
    unsigned int len = (unsigned int)wav[at + 4] | (unsigned int)wav[at + 5] << 8 | (unsigned int)wav[at + 6] << 16 |
                       (unsigned int)wav[at + 7] << 24;
    const unsigned char *data = wav + at + 8;
    if (len > size - at - 8) return NULL;
    if (memcmp(wav + at, "fmt ", 4) == 0 && len >= 16) {
      int format = data[0] | data[1] << 8, channels = data[2] | data[3] << 8, bits = data[14] | data[15] << 8;
      unsigned int rate = (unsigned int)data[4] | (unsigned int)data[5] << 8 | (unsigned int)data[6] << 16 |
                          (unsigned int)data[7] << 24;
      fmt_ok = format == 1 && channels == 1 && bits == 16 && rate == WHISPER_SAMPLE_RATE;
    } else if (memcmp(wav + at, "data", 4) == 0) {
      if (!fmt_ok) return NULL;
      int n = (int)(len / 2);
      float *out = malloc(sizeof(float) * (size_t)(n > 0 ? n : 1));
      if (!out) return NULL;
      for (int i = 0; i < n; i++) {
        short s = (short)(data[i * 2] | data[i * 2 + 1] << 8);
        out[i] = (float)s / 32768.0f;
      }
      *count = n;
      return out;
    }
    at += 8 + len + (len & 1);
  }
  return NULL;
}

/* whisper-server's verbose_json for what was heard (only the fields Drashti reads, in its shape). */
static void verbose_json(buf *b, int samples, bool probabilities) {
  puts_(b, "{\"task\":\"transcribe\",\"language\":");
  put_json_string(b, whisper_lang_str_full(whisper_full_lang_id(ctx)));
  puts_(b, ",\"duration\":");
  putnum(b, (double)samples / WHISPER_SAMPLE_RATE);
  if (probabilities) {
    int max = whisper_lang_max_id();
    float *p = calloc((size_t)max + 1, sizeof(float));
    if (p) {
      int top = whisper_lang_auto_detect(ctx, 0, threads, p);
      if (top >= 0 && top <= max) {
        puts_(b, ",\"detected_language\":");
        put_json_string(b, whisper_lang_str_full(top));
        puts_(b, ",\"detected_language_probability\":");
        putnum(b, p[top]);
      }
      puts_(b, ",\"language_probabilities\":{");
      bool first = true;
      for (int i = 0; i <= max; i++) {
        if (p[i] <= 0.001f) continue;
        if (!first) puts_(b, ",");
        first = false;
        put_json_string(b, whisper_lang_str(i));
        puts_(b, ":");
        putnum(b, p[i]);
      }
      puts_(b, "}");
      free(p);
    }
  }
  puts_(b, ",\"segments\":[");
  int n = whisper_full_n_segments(ctx);
  whisper_token eot = whisper_token_eot(ctx);
  for (int i = 0; i < n; i++) {
    if (i > 0) puts_(b, ",");
    puts_(b, "{\"id\":");
    putnum(b, i);
    puts_(b, ",\"text\":");
    put_json_string(b, whisper_full_get_segment_text(ctx, i));
    puts_(b, ",\"start\":");
    putnum(b, whisper_full_get_segment_t0(ctx, i) * 0.01);
    puts_(b, ",\"end\":");
    putnum(b, whisper_full_get_segment_t1(ctx, i) * 0.01);
    puts_(b, ",\"no_speech_prob\":");
    putnum(b, whisper_full_get_segment_no_speech_prob(ctx, i));
    puts_(b, ",\"words\":[");
    int tokens = whisper_full_n_tokens(ctx, i);
    bool first = true;
    for (int j = 0; j < tokens; j++) {
      whisper_token_data d = whisper_full_get_token_data(ctx, i, j);
      if (d.id >= eot) continue;
      char word[512];
      const char *text = whisper_full_get_token_text(ctx, i, j);
      if (!text) continue;
      snprintf(word, sizeof word, "%s", text);
      int64_t t1 = d.t1;
      /* A letter split over tokens: joined, as whisper-server does. */
      while (j + 1 < tokens && trailing_needed(word) > 0) {
        whisper_token_data next = whisper_full_get_token_data(ctx, i, j + 1);
        if (next.id >= eot) break;
        const char *more = whisper_full_get_token_text(ctx, i, j + 1);
        if (!more) break;
        j++;
        size_t have = strlen(word);
        snprintf(word + have, sizeof word - have, "%s", more);
        if (next.t1 > -1) t1 = next.t1;
      }
      if (!first) puts_(b, ",");
      first = false;
      puts_(b, "{\"word\":");
      put_json_string(b, word);
      puts_(b, ",\"start\":");
      putnum(b, d.t0 * 0.01);
      puts_(b, ",\"end\":");
      putnum(b, t1 * 0.01);
      puts_(b, ",\"probability\":");
      putnum(b, d.p);
      puts_(b, "}");
    }
    puts_(b, "]}");
  }
  puts_(b, "]}");
}

static void inference(int fd, const char *head, const char *body, size_t size) {
  char type[512];
  if (!header(head, "Content-Type", type, sizeof type)) {
    reply(fd, 400, "{\"error\":\"no content type\"}");
    return;
  }
  const char *b = strstr(type, "boundary=");
  if (!b) {
    reply(fd, 400, "{\"error\":\"no boundary\"}");
    return;
  }
  char boundary[200];
  snprintf(boundary, sizeof boundary, "%s", b + 9);
  if (boundary[0] == '"') {
    memmove(boundary, boundary + 1, strlen(boundary));
    char *q = strchr(boundary, '"');
    if (q) *q = 0;
  }
  part ps[16];
  int n = parts_of(body, size, boundary, ps, 16);
  const part *file = field(ps, n, "file");
  if (!file) {
    reply(fd, 400, "{\"error\":\"no file\"}");
    return;
  }
  char language[16] = "en", temperature[32] = "0", temperature_inc[32] = "0.2", no_probs[16] = "false";
  if (field(ps, n, "language")) text_of(field(ps, n, "language"), language, sizeof language);
  if (field(ps, n, "temperature")) text_of(field(ps, n, "temperature"), temperature, sizeof temperature);
  if (field(ps, n, "temperature_inc")) text_of(field(ps, n, "temperature_inc"), temperature_inc, sizeof temperature_inc);
  if (field(ps, n, "no_language_probabilities"))
    text_of(field(ps, n, "no_language_probabilities"), no_probs, sizeof no_probs);
  int count = 0;
  float *pcm = samples_of((const unsigned char *)file->data, file->size, &count);
  if (!pcm) {
    reply(fd, 400, "{\"error\":\"failed to read audio data\"}");
    return;
  }
  struct whisper_full_params wp = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
  wp.n_threads = threads;
  wp.print_progress = false;
  wp.print_realtime = false;
  wp.print_timestamps = false;
  wp.print_special = false;
  wp.translate = false;
  wp.no_context = true;
  wp.token_timestamps = true;
  wp.max_len = 60;
  wp.language = language;
  wp.detect_language = false;
  wp.temperature = strtof(temperature, NULL);
  wp.temperature_inc = strtof(temperature_inc, NULL);
  if (whisper_full(ctx, wp, pcm, count) != 0) {
    free(pcm);
    reply(fd, 500, "{\"error\":\"failed to process audio\"}");
    return;
  }
  buf out = {0};
  verbose_json(&out, count, strcmp(no_probs, "true") != 0);
  reply(fd, 200, out.s ? out.s : "{}");
  free(out.s);
  free(pcm);
}

static void serve(int fd) {
  char *head = malloc(MAX_HEAD + 1);
  if (!head) return;
  size_t got = 0;
  char *end = NULL;
  while (got < MAX_HEAD) {
    ssize_t r = read(fd, head + got, MAX_HEAD - got);
    if (r <= 0) break;
    got += (size_t)r;
    head[got] = 0;
    end = memmem(head, got, "\r\n\r\n", 4);
    if (end) break;
  }
  if (!end) {
    free(head);
    return;
  }
  size_t head_len = (size_t)(end - head) + 4;
  if (strncmp(head, health_request, strlen(health_request)) == 0) {
    reply(fd, 200, "{\"status\":\"ok\"}");
  } else if (strncmp(head, inference_request, strlen(inference_request)) == 0) {
    char length[32];
    long size = header(head, "Content-Length", length, sizeof length) ? strtol(length, NULL, 10) : -1;
    if (size < 0 || size > MAX_BODY) {
      reply(fd, 413, "{\"error\":\"too large\"}");
    } else {
      char *body = malloc((size_t)size + 1);
      if (body) {
        size_t have = got - head_len;
        if (have > (size_t)size) have = (size_t)size;
        memcpy(body, head + head_len, have);
        while (have < (size_t)size) {
          ssize_t r = read(fd, body + have, (size_t)size - have);
          if (r <= 0) break;
          have += (size_t)r;
        }
        body[have] = 0;
        if (have == (size_t)size) inference(fd, head, body, have);
        free(body);
      }
    }
  } else {
    reply(fd, 404, "{\"error\":\"not found\"}");
  }
  free(head);
}

/* whisper.cpp's own messages (loading, timings) go nowhere: never a word heard, but nothing at all is simplest. */
static void quiet(enum ggml_log_level level, const char *text, void *user) {
  (void)level;
  (void)text;
  (void)user;
}

int main(int argc, char **argv) {
  const char *model = NULL;
  const char *request_path = NULL;
  int port = 0;
  bool gpu = true;
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--help") == 0) {
      fputs(usage, stdout);
      return 0;
    } else if (strcmp(argv[i], "-m") == 0 && i + 1 < argc) model = argv[++i];
    else if (strcmp(argv[i], "--port") == 0 && i + 1 < argc) port = atoi(argv[++i]);
    else if (strcmp(argv[i], "--request-path") == 0 && i + 1 < argc) request_path = argv[++i];
    else if (strcmp(argv[i], "-t") == 0 && i + 1 < argc) threads = atoi(argv[++i]);
    else if (strcmp(argv[i], "--host") == 0 && i + 1 < argc) {
      /* Only this computer may ask it. */
      if (strcmp(argv[++i], "127.0.0.1") != 0) {
        fprintf(stderr, "drashti-whisper: listens on 127.0.0.1 only\n");
        return 2;
      }
    } else if (strcmp(argv[i], "-ng") == 0 || strcmp(argv[i], "--no-gpu") == 0) gpu = false;
  }
  if (!model || port <= 0 || port > 65535 || threads < 1 || !request_path
      || request_path[0] != '/' || strlen(request_path) != 33
      || strspn(request_path + 1, "0123456789abcdef") != 32) {
    fputs(usage, stderr);
    return 2;
  }
  snprintf(health_request, sizeof health_request, "GET %s/health ", request_path);
  snprintf(inference_request, sizeof inference_request, "POST %s/inference ", request_path);
  signal(SIGPIPE, SIG_IGN);
  whisper_log_set(quiet, NULL);
  struct whisper_context_params cp = whisper_context_default_params();
  cp.use_gpu = gpu;
  ctx = whisper_init_from_file_with_params(model, cp);
  if (!ctx) {
    fprintf(stderr, "drashti-whisper: the model could not be loaded\n");
    return 3;
  }
  int s = socket(AF_INET, SOCK_STREAM, 0);
  int yes = 1;
  setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof yes);
  struct sockaddr_in at;
  memset(&at, 0, sizeof at);
  at.sin_family = AF_INET;
  at.sin_port = htons((unsigned short)port);
  at.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (bind(s, (struct sockaddr *)&at, sizeof at) != 0 || listen(s, 8) != 0) {
    fprintf(stderr, "drashti-whisper: cannot listen on 127.0.0.1:%d\n", port);
    return 4;
  }
  for (;;) {
    int c = accept(s, NULL, NULL);
    if (c < 0) continue;
    struct timeval wait = {30, 0};
    setsockopt(c, SOL_SOCKET, SO_RCVTIMEO, &wait, sizeof wait);
    serve(c);
    close(c);
  }
}
