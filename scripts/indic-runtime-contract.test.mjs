// Node's type stripping checks the transport contract without Electron/build/start-up. Vitest separately covers
// the full speech-engine integration under the shared heavy lock.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { pcmFrame, indicWords, routeCFiles } from '../src/main/speech/indic-protocol.ts';
test('PCM and native words have strict audio and timing bounds', () => {
  assert.deepEqual([...pcmFrame(new Int16Array([-32768, 1, 32767]))], [6, 0, 0, 0, 0, 128, 1, 0, 255, 127]);
  assert.throws(() => pcmFrame(new Int16Array(192001)), /PCM bounds/);
  assert.throws(() => indicWords({ language: 'hi', words: [] }, 'gu', 0, 1000), /Invalid recogniser reply/);
  assert.deepEqual(
    indicWords({ language: 'gu', words: [{ w: 'shape', start: 0.04, end: 1 }] }, 'gu', 1000, 1500),
    [{ text: 'shape', startAt: 1040, endAt: 1500, confidence: null }],
  );
});

test('the shared recogniser seam refuses unsupported languages even if a pack claims them', () => {
  const pack = {
    format: 'indicconformer-ctc-onnx-v1',
    purposes: ['captions-en'],
    files: [
      { name: 'model.onnx', path: '/p/model.onnx' },
      { name: 'tokens.txt', path: '/p/tokens.txt' },
      { name: 'frontend.bin', path: '/p/frontend.bin' },
    ],
  };
  assert.equal(routeCFiles(pack, 'en'), null);
});

test('a language-masked CTC graph cannot claim both Gujarati and Hindi', () => {
  const pack = {
    format: 'indicconformer-ctc-onnx-v1',
    purposes: ['captions-gu', 'captions-hi'],
    files: [
      { name: 'model.onnx', path: '/p/model.onnx' },
      { name: 'tokens.txt', path: '/p/tokens.txt' },
      { name: 'frontend.bin', path: '/p/frontend.bin' },
    ],
  };
  assert.equal(routeCFiles(pack, 'gu'), null);
  assert.equal(routeCFiles(pack, 'hi'), null);
});

test('Indic unknown-token markers never reach displayed words, while malformed replies still fail', () => {
  assert.deepEqual(
    indicWords(
      {
        language: 'gu',
        words: [
          { w: '<unk>', start: 0, end: 0.04 },
          { w: 'sha<unk>pe', start: 0.04, end: 0.08 },
          { w: '<unk>', start: 0.08, end: 0.12 },
          { w: 'box', start: 0.12, end: 0.16 },
        ],
      },
      'gu',
      1000,
      2000,
    ),
    [
      { text: 'shape', startAt: 1040, endAt: 1080, confidence: null },
      { text: 'box', startAt: 1120, endAt: 1160, confidence: null },
    ],
  );
  assert.throws(
    () => indicWords({ language: 'gu', words: [{ w: '', start: 0, end: 0.04 }] }, 'gu', 0, 1000),
    /Invalid recogniser reply/,
  );
  assert.throws(
    () => indicWords({ language: 'gu', words: [{ w: '<unk>', start: 0, end: 13 }] }, 'gu', 0, 1000),
    /Invalid recogniser reply/,
  );
});

/**
 * The C source's allocations (`name = malloc(`, `calloc(`, `realloc(`), and those used before their null check: after
 * the statement that allocates it, the name's first appearance must be `!name` (cap-review-next n3: any use, such as
 * `memcpy(name, …)`, `name->` or a call with it, not only `name[` and `(name +`). Comments, strings and characters are
 * no use.
 */
function allocationsUsedUnchecked(source) {
  // One pass, left to right, so a quote in a comment or a slash in a string is read as C reads it.
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/gu, (t) =>
    t.startsWith('/') ? ' ' : `${t[0] ?? ''}${t[0] ?? ''}`,
  );
  const allocations = [...code.matchAll(/\b(\w+)\s*=\s*(?:malloc|calloc|realloc)\(/gu)];
  const unchecked = [];
  for (const allocation of allocations) {
    const name = allocation[1] ?? '';
    const end = code.indexOf(';', allocation.index);
    const after = end < 0 ? '' : code.slice(end + 1);
    const first = after.search(new RegExp(`\\b${name}\\b`, 'u'));
    if (first < 1 || after[first - 1] !== '!') unchecked.push(name);
  }
  return { count: allocations.length, unchecked };
}

test('the helper checks every allocation before using it: it says so and exits, never writes through null (review)', () => {
  const source = readFileSync(new URL('../tools/indic-conformer/ic_ctc.c', import.meta.url), 'utf8');
  const { count, unchecked } = allocationsUsedUnchecked(source);
  assert.ok(count >= 10);
  assert.deepEqual(unchecked, [], `${unchecked.join(', ')}: used before the allocation is checked`);
});

test('the allocation rule sees any use before the check: a copy into it, a member through it, a call with it (cap-review-next n3)', () => {
  const unchecked = (body) => allocationsUsedUnchecked(`static void f(void) {\n${body}\n}\n`).unchecked;
  assert.deepEqual(
    unchecked('  char *buf = malloc(8);\n  memcpy(buf, "abc", 4);\n  if (!buf) die("allocation failed");'),
    ['buf'],
  );
  assert.deepEqual(
    unchecked('  struct s *p = calloc(1, sizeof *p);\n  p->len = 0;\n  if (!p) die("allocation failed");'),
    ['p'],
  );
  assert.deepEqual(unchecked('  float *x = malloc(4);\n  fill(x, 1);\n  if (!x) die("allocation failed");'), [
    'x',
  ]);
  // Checked first, then used: none, however it is used; a comment or a string naming it is no use.
  assert.deepEqual(
    unchecked(
      '  int *ids = malloc(4), *fr = malloc(4);\n  if (!ids || !fr) die("allocation failed");\n  ids[0] = fr[0] = 0;',
    ),
    [],
  );
  assert.deepEqual(
    unchecked(
      '  char *t = calloc(9, 1);\n  if (!t) die("allocation failed");\n  t = realloc(t, 18);\n  if (!t) die("allocation failed");\n  t->x = 0;',
    ),
    [],
  );
  assert.deepEqual(
    unchecked(
      '  char *buf = malloc(8);\n  /* buf: the bytes */ puts("buf");\n  if (!buf) die("allocation failed");\n  memcpy(buf, "abc", 4);',
    ),
    [],
  );
});
