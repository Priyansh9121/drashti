import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// Frozen pre-optimization FFT: byte equality protects acoustic inputs, including signed zero.
const reference = "static void reference_fft512(double *re, double *im) { /* in-place radix-2 */\n  for (int i = 1, j = 0; i < NFFT; i++) {\n    int bit = NFFT >> 1;\n    for (; j & bit; bit >>= 1) j ^= bit;\n    j ^= bit;\n    if (i < j) { double t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }\n  }\n  for (int len = 2; len <= NFFT; len <<= 1) {\n    double a = -2 * M_PI / len;\n    for (int i = 0; i < NFFT; i += len)\n      for (int k = 0; k < len / 2; k++) {\n        double wr = cos(a * k), wi = sin(a * k);\n        double ur = re[i + k], ui = im[i + k];\n        double vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;\n        double vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;\n        re[i + k] = ur + vr; im[i + k] = ui + vi;\n        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;\n      }\n  }\n}";

test('native FFT keeps every output bit while computing its twiddles only once', () => {
  const source = readFileSync(new URL('../tools/indic-conformer/ic_ctc.c', import.meta.url), 'utf8');
  const begin = source.indexOf('/* ---- front end ---- */');
  const end = source.indexOf('/* Returns features');
  assert.ok(begin > 0 && end > begin);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-fft-'));
  try {
    const file = join(dir, 'fft.c');
    const binary = join(dir, process.platform === 'win32' ? 'fft.exe' : 'fft');
    writeFileSync(file, `
#include <math.h>
#include <stdio.h>
#include <string.h>
#define M_PI 3.14159265358979323846
#define NFFT 512
static int calls;
static double counted_cos(double x) { calls++; return cos(x); }
static double counted_sin(double x) { calls++; return sin(x); }
${reference}
#define cos counted_cos
#define sin counted_sin
${source.slice(begin, end)}
#undef cos
#undef sin
int main(void) {
  for (int trial = 0; trial < 12; trial++) {
    double re[NFFT], im[NFFT], old_re[NFFT], old_im[NFFT];
    for (int i = 0; i < NFFT; i++) {
      re[i] = trial == 0 ? 0 : trial == 1 ? (i == 0 ? 1 : 0) :
        sin(i * (trial + 1) * 0.017) * (trial % 2 ? 32768 : 0.00001);
      im[i] = trial < 3 ? 0 : cos(i * trial * 0.013);
    }
    memcpy(old_re, re, sizeof re); memcpy(old_im, im, sizeof im);
    reference_fft512(old_re, old_im); fft512(re, im);
    if (memcmp(re, old_re, sizeof re) || memcmp(im, old_im, sizeof im)) return 2;
  }
  if (calls > 1022) { fprintf(stderr, "repeated twiddles: %d\\n", calls); return 3; }
  return 0;
}
`);
    if (process.platform === 'win32') {
      execFileSync('cl', ['/nologo', '/O2', '/W4', '/WX', file, `/Fe${binary}`, `/Fo${join(dir, 'fft.obj')}`]);
    } else {
      execFileSync('cc', ['-O2', '-Wall', '-Wextra', '-Werror', file, '-lm', '-o', binary]);
    }
    execFileSync(binary);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
