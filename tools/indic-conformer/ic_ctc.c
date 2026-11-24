/* Drashti Route C. Adapted from cap-route-c trial helper, 23 Nov 2026.
 * NeMo log-mel + greedy language-masked CTC, 40ms coarse token times; each word's confidence "c" is the mean, over
 * the frames its tokens were emitted on, of the top token's posterior (softmax of the 257 scores); the reply-level
 * "confidence" stays null.
 * Models/frontend/tokens come only from a checked imported pack; no acoustic weights here.
 */
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#ifdef _WIN32
#include <windows.h>
#include <io.h>
#include <fcntl.h>
#define strdup _strdup
#endif
#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif
#include "onnxruntime_c_api.h"

#define SR 16000
#define NFFT 512
#define WIN 400
#define HOP 160
#define NBIN (NFFT / 2 + 1)
#define NMEL 80
#define NTOK 257 /* 256 language pieces + blank */
#define BLANK 256

static const OrtApi *ort;

static void die(const char *m) { fprintf(stderr, "ic-ctc: %s\n", m); exit(2); }
static void check(OrtStatus *s) {
  if (s) { fprintf(stderr, "ic-ctc: inference failed\n"); ort->ReleaseStatus(s); exit(3); }
}
static double now_ms(void) {
#ifdef _WIN32
  LARGE_INTEGER t, f; QueryPerformanceCounter(&t); QueryPerformanceFrequency(&f);
  return (double)t.QuadPart * 1e3 / (double)f.QuadPart;
#else
  struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec * 1e3 + t.tv_nsec / 1e6;
#endif
}

/* ---- front end ---- */
static void fft512(double *re, double *im) { /* in-place radix-2 */
  for (int i = 1, j = 0; i < NFFT; i++) {
    int bit = NFFT >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { double t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (int len = 2; len <= NFFT; len <<= 1) {
    double a = -2 * M_PI / len;
    for (int i = 0; i < NFFT; i += len)
      for (int k = 0; k < len / 2; k++) {
        double wr = cos(a * k), wi = sin(a * k);
        double ur = re[i + k], ui = im[i + k];
        double vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        double vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
      }
  }
}

/* Returns features [NMEL][T] (row-major, T frames). fb is [NMEL][NBIN]. */
static float *logmel(const float *x, size_t n, const float *fb, int *T_out) {
  int T = (int)(n / HOP) + 1; /* NeMo get_seq_len with centre padding: floor(n / hop) + 1 */
  float *y = malloc(sizeof(float) * (n ? n : 1));
  if (!y) die("allocation failed");
  if (n) { y[0] = x[0]; for (size_t i = 1; i < n; i++) y[i] = x[i] - 0.97f * x[i - 1]; }
  double win[NFFT] = {0};
  for (int i = 0; i < WIN; i++) win[(NFFT - WIN) / 2 + i] = 0.5 - 0.5 * cos(2 * M_PI * i / (WIN - 1));
  float *feat = malloc(sizeof(float) * NMEL * T);
  if (!feat) die("allocation failed");
  double re[NFFT], im[NFFT], pw[NBIN];
  for (int t = 0; t < T; t++) {
    long start = (long)t * HOP - NFFT / 2;
    for (int i = 0; i < NFFT; i++) {
      long k = start + i; /* reflect padding (torch.stft centre=True, pad_mode reflect) */
      if (n == 1) k = 0;
      else { while (k < 0 || k >= (long)n) { if (k < 0) k = -k; if (k >= (long)n) k = 2 * ((long)n - 1) - k; } }
      re[i] = n ? y[k] * win[i] : 0; im[i] = 0;
    }
    fft512(re, im);
    for (int b = 0; b < NBIN; b++) { double m = sqrt(re[b] * re[b] + im[b] * im[b]); pw[b] = m * m; }
    for (int m = 0; m < NMEL; m++) {
      double s = 0; const float *w = fb + m * NBIN;
      for (int b = 0; b < NBIN; b++) s += w[b] * pw[b];
      feat[m * T + t] = (float)log(s + 5.9604644775390625e-08);
    }
  }
  for (int m = 0; m < NMEL; m++) { /* per_feature normalisation, unbiased std + 1e-5 */
    double mean = 0, var = 0; float *r = feat + m * T;
    for (int t = 0; t < T; t++) mean += r[t];
    mean /= T;
    for (int t = 0; t < T; t++) var += (r[t] - mean) * (r[t] - mean);
    double sd = (T > 1 ? sqrt(var / (T - 1)) : NAN) + 1e-5;
    for (int t = 0; t < T; t++) r[t] = (float)((r[t] - mean) / sd);
  }
  free(y);
  *T_out = T;
  return feat;
}

/* Only the reviewed CTC head. No Python, network, custom operator library or RNNT decoder. */
typedef struct { char code[8]; OrtSession *sess; char *in0, *in1, *out[3]; size_t nout; char *tok[NTOK]; double load_ms; } Model;
static OrtEnv *env; static OrtSessionOptions *so; static OrtAllocator *al; static OrtMemoryInfo *mi;
static float *fb;
static FILE *open_utf8(const char *path);
static void load_model(Model *m, const char *code, const char *path, const char *tokpath) {
  snprintf(m->code, sizeof m->code, "%s", code);
  FILE *f = open_utf8(tokpath); if (!f) die("cannot open tokens");
  char line[256]; int i = 0;
  while (i < NTOK && fgets(line, sizeof line, f)) {
    if (!strchr(line, '\n') && !feof(f)) die("token exceeds bounds");
    line[strcspn(line, "\r\n")] = 0;
    m->tok[i] = strdup(line); if (!m->tok[i++]) die("allocation failed");
  }
  if (fgetc(f) != EOF) die("extra tokens"); fclose(f);
  if (i != NTOK || strcmp(m->tok[BLANK], "<blank>")) die("tokens file must have 256 pieces then <blank>");
  double t0 = now_ms();
#ifdef _WIN32
  int wn = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, NULL, 0);
  if (!wn) die("invalid model path");
  wchar_t *wp = malloc((size_t)wn * sizeof(wchar_t));
  if (!wp || !MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, wp, wn)) die("invalid model path");
  check(ort->CreateSession(env, wp, so, &m->sess)); free(wp);
#else
  check(ort->CreateSession(env, path, so, &m->sess));
#endif
  m->load_ms = now_ms() - t0;
  size_t ni; check(ort->SessionGetInputCount(m->sess, &ni));
  if (ni != 2) die("model requires feature and length inputs");
  check(ort->SessionGetInputName(m->sess, 0, al, &m->in0)); check(ort->SessionGetInputName(m->sess, 1, al, &m->in1));
  check(ort->SessionGetOutputCount(m->sess, &m->nout));
  if (m->nout < 1 || m->nout > 3) die("invalid model outputs");
  for (size_t k = 0; k < m->nout; k++) check(ort->SessionGetOutputName(m->sess, k, al, &m->out[k]));
}

static void json_str(FILE *o, const char *s) {
  fputc('"', o);
  for (; *s; s++) {
    unsigned char c = (unsigned char)*s;
    if (c == '"' || c == '\\') { fputc('\\', o); fputc(c, o); }
    else if (c < 0x20) fprintf(o, "\\u%04x", c);
    else fputc(c, o);
  }
  fputc('"', o);
}

/* Decodes one input and prints one JSON line. */
static void decode(Model *m, const char *name, float *x, size_t n, int threads) {
  if (!x || n < WIN) die("PCM shorter than one window");
  double ta = now_ms(); int T;
  float *feat = logmel(x, n, fb, &T);
  double tb = now_ms();
  int64_t fshape[3] = {1, NMEL, T}, lshape[1] = {1}, len = T;
  OrtValue *vin[2] = {0, 0}, *vout[3] = {0, 0, 0};
  check(ort->CreateTensorWithDataAsOrtValue(mi, feat, sizeof(float) * NMEL * T, fshape, 3, ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT, &vin[0]));
  check(ort->CreateTensorWithDataAsOrtValue(mi, &len, sizeof len, lshape, 1, ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64, &vin[1]));
  const char *ins[2] = {m->in0, m->in1};
  size_t no = 1;
  check(ort->Run(m->sess, NULL, ins, (const OrtValue *const *)vin, 2, (const char *const *)m->out, no, vout));
  double tc = now_ms();
  float *lp; check(ort->GetTensorMutableData(vout[0], (void **)&lp));
  OrtTensorTypeAndShapeInfo *si; check(ort->GetTensorTypeAndShape(vout[0], &si));
  size_t rank; ONNXTensorElementDataType dtype;
  check(ort->GetDimensionsCount(si, &rank)); check(ort->GetTensorElementType(si, &dtype));
  if (rank != 3 || dtype != ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT) die("invalid output tensor");
  int64_t dims[3]; check(ort->GetDimensions(si, dims, 3)); ort->ReleaseTensorTypeAndShapeInfo(si);
  int Tp = (int)dims[1];
  if (dims[0] != 1 || dims[1] < 1 || dims[1] > 1201 || dims[2] != NTOK) die("invalid output shape");
  int cap_ids = 4 * Tp + 16, nid = 0; int *ids = malloc(sizeof(int) * cap_ids), *fr = malloc(sizeof(int) * cap_ids), *fe = malloc(sizeof(int) * cap_ids);
  double *ps = malloc(sizeof(double) * cap_ids); int *pn = malloc(sizeof(int) * cap_ids);
  if (!ids || !fr || !fe || !ps || !pn) die("allocation failed");
  { /* greedy CTC; each emitted token keeps the sum and count of its frames' top posteriors */
    int prev = BLANK;
    for (int t = 0; t < Tp; t++) {
      const float *r = lp + (size_t)t * NTOK; int best = 0;
      if (!isfinite(r[0])) die("non-finite logits");
      for (int k = 1; k < NTOK; k++) if (!isfinite(r[k])) die("non-finite logits"); else if (r[k] > r[best]) best = k;
      double z = 0; /* softmax of the scores at the top one: 1 / sum(exp(r[k] - r[best])) */
      for (int k = 0; k < NTOK; k++) z += exp((double)r[k] - (double)r[best]);
      double p = 1.0 / z;
      if (best != prev && best != BLANK && nid < cap_ids) { ids[nid] = best; fr[nid] = fe[nid] = t; ps[nid] = p; pn[nid] = 1; nid++; }
      else if (best != BLANK && best == prev && nid > 0) { fe[nid - 1] = t; ps[nid - 1] += p; pn[nid - 1]++; } /* a repeated frame extends the token */
      prev = best;
    }
  }
  double td = now_ms();
  /* text: pieces joined, U+2581 -> space (the fork's ids_to_text); a word starts at a piece beginning with U+2581 */
  size_t cap = 4096, tl = 0; char *text = calloc(cap, 1);
  if (!text) die("allocation failed");
  static char words[1024][256]; static double ws[1024], we[1024], wp[1024]; static int wn[1024]; int nw = -1;
  for (int i = 0; i < nid; i++) {
    const char *pc = m->tok[ids[i]];
    int newword = !strncmp(pc, "\xe2\x96\x81", 3);
    /* An over-long phrase is cut at a piece, never the helper's exit (review S3): the text's 4 KB and 1,024 words. */
    if (tl + strlen(pc) + 2 >= cap || ((newword || nw < 0) && nw >= 1023)) break;
    for (const char *s = pc; *s;) {
      if (!strncmp(s, "\xe2\x96\x81", 3)) { text[tl++] = ' '; s += 3; } else text[tl++] = *s++;
    }
    text[tl] = 0;
    if (newword || nw < 0) { nw++; words[nw][0] = 0; ws[nw] = fr[i] * 0.04; wp[nw] = 0; wn[nw] = 0; }
    /* A word over 255 bytes is cut at a piece too; the pieces after it in that word are left out. */
    if (strlen(words[nw]) + strlen(newword ? pc + 3 : pc) >= sizeof words[nw]) continue;
    wp[nw] += ps[i]; wn[nw] += pn[i];
    strcat(words[nw], newword ? pc + 3 : pc);
    we[nw] = (fe[i] + 1) * 0.04;
  }
  while (tl > 0 && text[tl - 1] == ' ') text[--tl] = 0;
  const char *shown = text;
  while (*shown == ' ') shown++;
  double secs = (double)n / SR;
  printf("{\"file\":"); json_str(stdout, name);
  printf(",\"language\":\"%s\",\"decoder\":\"%s\",\"text\":", m->code, "ctc"); json_str(stdout, shown);
  printf(",\"words\":[");
  int emitted = 0;
  for (int w = 0; w <= nw; w++) { if (!words[w][0]) continue; if (emitted++) fputc(',', stdout); printf("{\"w\":"); json_str(stdout, words[w]); printf(",\"start\":%.2f,\"end\":%.2f,\"c\":%.3f}", ws[w], we[w], wn[w] > 0 ? wp[w] / wn[w] : 0.0); }
  printf("],\"timing\":\"coarse: token frames (40 ms)\",\"confidence\":null,\"audio_s\":%.3f,\"frames\":%d,\"enc_frames\":%d,\"frontend_ms\":%.1f,\"infer_ms\":%.1f,\"decode_ms\":%.1f,\"rtf\":%.4f,\"threads\":%d}\n",
         secs, T, Tp, tb - ta, tc - tb, td - tc, secs > 0 ? (td - ta) / 1e3 / secs : 0, threads);
  fflush(stdout);
  ort->ReleaseValue(vin[0]); ort->ReleaseValue(vin[1]);
  for (int k = 0; k < 3; k++) if (vout[k]) ort->ReleaseValue(vout[k]);
  free(ids); free(fr); free(fe); free(ps); free(pn); free(text); free(feat); free(x);
}


/* Private production pipe: uint32 LE byte count followed by exactly that many s16le samples.
 * One response per frame; EOF ends the process. No filesystem audio and no request-controlled paths. */
static FILE *open_utf8(const char *path) {
#ifdef _WIN32
  int n = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, NULL, 0);
  if (!n) return NULL;
  wchar_t *p = malloc((size_t)n * sizeof(wchar_t)); if (!p) return NULL;
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, p, n);
  FILE *f = _wfopen(p, L"rb"); free(p); return f;
#else
  return fopen(path, "rb");
#endif
}
static int ic_main(int argc, char **argv) {
  const char *code = NULL, *model = NULL, *tokens = NULL, *frontend = NULL; int threads = 1, serve = 0, admit = 0;
  if (argc == 2 && !strcmp(argv[1], "--runtime")) {
    /* The packaged self-test: ONNX Runtime loads beside the helper and starts, without any model or input. */
    const OrtApiBase *base = OrtGetApiBase();
    ort = base->GetApi(ORT_API_VERSION); if (!ort) die("runtime API mismatch");
    check(ort->CreateEnv(ORT_LOGGING_LEVEL_FATAL, "ic-ctc", &env));
    printf("{\"runtime\":"); json_str(stdout, base->GetVersionString()); printf(",\"api\":%d}\n", ORT_API_VERSION);
    fflush(stdout);
    ort->ReleaseEnv(env);
    return 0;
  }
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--lang") && i + 3 < argc && !code) { code = argv[++i]; model = argv[++i]; tokens = argv[++i]; }
    else if (!strcmp(argv[i], "--frontend") && i + 1 < argc) frontend = argv[++i];
    else if (!strcmp(argv[i], "--threads") && i + 1 < argc) threads = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--pcm-serve")) serve = 1;
    else if (!strcmp(argv[i], "--admit")) admit = 1;
    else die("invalid arguments");
  }
  if (!serve || !code || (strcmp(code,"gu") && strcmp(code,"hi")) || !frontend || threads < 1 || threads > 2) die("invalid configuration");
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
#endif
  if (admit) { char go[4]; if (fread(go, 1, 4, stdin) != 4 || memcmp(go, "GO01", 4)) die("load not admitted"); }
  fb = malloc(sizeof(float) * NMEL * NBIN); if (!fb) die("allocation failed");
  FILE *f = open_utf8(frontend);
  if (!f || fread(fb, sizeof(float), NMEL * NBIN, f) != NMEL * NBIN || fgetc(f) != EOF) die("frontend dimensions");
  fclose(f);
  for (int i = 0; i < NMEL * NBIN; i++) if (!isfinite(fb[i])) die("invalid frontend");
  ort = OrtGetApiBase()->GetApi(ORT_API_VERSION); if (!ort) die("runtime API mismatch");
  check(ort->CreateEnv(ORT_LOGGING_LEVEL_FATAL, "ic-ctc", &env));
  check(ort->CreateSessionOptions(&so));
  check(ort->SetIntraOpNumThreads(so, threads)); check(ort->SetInterOpNumThreads(so, 1));
  check(ort->SetSessionGraphOptimizationLevel(so, ORT_ENABLE_ALL));
  check(ort->GetAllocatorWithDefaultOptions(&al)); check(ort->CreateCpuMemoryInfo(OrtArenaAllocator, OrtMemTypeDefault, &mi));
  Model m = {0}; load_model(&m, code, model, tokens);
  printf("{\"ready\":true,\"protocolVersion\":1,\"sampleRate\":16000,\"channels\":1,\"sampleFormat\":\"s16le\"}\n"); fflush(stdout);
  unsigned char header[4]; size_t got;
  while ((got = fread(header, 1, 4, stdin)) != 0) {
    if (got != 4) die("truncated PCM header");
    uint32_t bytes = (uint32_t)header[0] | (uint32_t)header[1] << 8 | (uint32_t)header[2] << 16 | (uint32_t)header[3] << 24;
    if (!bytes || bytes > 384000 || bytes % 2) die("PCM bounds");
    unsigned char *pcm = malloc(bytes); size_t n = bytes / 2;
    float *x = malloc(n * sizeof(float)); if (!pcm || !x) die("allocation failed");
    if (fread(pcm, 1, bytes, stdin) != bytes) die("truncated PCM frame");
    for (size_t i = 0; i < n; i++) x[i] = (int16_t)((uint16_t)pcm[i*2] | (uint16_t)pcm[i*2+1] << 8) / 32768.0f;
    free(pcm); decode(&m, "pcm", x, n, threads);
  }
  if (ferror(stdin)) die("PCM input failed");
  ort->ReleaseSession(m.sess);
  for (int i = 0; i < NTOK; i++) free(m.tok[i]);
  al->Free(al, m.in0); al->Free(al, m.in1);
  for (size_t i = 0; i < m.nout; i++) al->Free(al, m.out[i]);
  ort->ReleaseMemoryInfo(mi); ort->ReleaseSessionOptions(so); ort->ReleaseEnv(env); free(fb);
  return 0;
}

#ifdef _WIN32
int wmain(int argc, wchar_t **wide) {
  char **args = calloc((size_t)argc, sizeof(char *)); if (!args) die("allocation failed");
  for (int i = 0; i < argc; i++) {
    int n = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, wide[i], -1, NULL, 0, NULL, NULL);
    if (!n) die("invalid arguments");
    args[i] = malloc((size_t)n); if (!args[i]) die("allocation failed");
    WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, wide[i], -1, args[i], n, NULL, NULL);
  }
  int result = ic_main(argc, args);
  for (int i = 0; i < argc; i++) free(args[i]); free(args); return result;
}
#else
int main(int argc, char **argv) { return ic_main(argc, argv); }
#endif
