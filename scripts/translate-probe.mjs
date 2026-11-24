// drashti-translate's own refusals, run against a packaged copy without any model (alpha.22, a22-review-mt A8):
// scripts/check-ffmpeg.mjs --packaged starts each packaged app's helper with these requests and checks every answer
// before its input ends. The native JSON reader and its bounds are the helper's most exposed code.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const missing = join(tmpdir(), 'drashti-translate-probe-missing', 'model');

/** The requests, one a line, in order: a bad line, a line over 64 KiB, then ops the helper must refuse or answer. */
export function probeLines() {
  return [
    'not json',
    JSON.stringify({ id: 2, op: 'pieces', route: 'en-indic', text: 'x'.repeat(70_000) }),
    JSON.stringify({ id: 3, op: 'dance' }),
    JSON.stringify({
      id: 4,
      op: 'translate',
      route: 'en-indic',
      src: 'eng_Latn',
      tgt: 'guj_Gujr',
      text: 'x',
      beam: 1,
    }),
    JSON.stringify({
      id: 5,
      op: 'load',
      route: 'en-indic',
      model: missing,
      spm: join(missing, 'source.spm'),
      threads: 1,
    }),
    JSON.stringify({ id: 6, op: 'cancel' }),
    JSON.stringify({ id: 7, op: 'quit' }),
  ];
}

/**
 * What the helper said, judged: its hello (protocol 1); the two lines it cannot read answered with no id (bad-json,
 * too-large); unknown-op, not-loaded, an unreadable tokenizer (or, for the Intel copy under Rosetta, "translated");
 * cancel and quit answered; exit 0. Replies are matched by id: the helper answers unreadable lines and cancels at
 * once, the rest in turn.
 */
export function judgeProbe(output, code) {
  const problems = [];
  const lines = output.split(/\r?\n/u).filter((l) => l.trim() !== '');
  const parsed = lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  });
  const hello = parsed[0];
  if (hello?.hello !== 'drashti-translate' || hello.protocol !== 1) problems.push('no hello in protocol 1');
  const replies = parsed.slice(1);
  if (replies.some((r) => r === null)) problems.push('a reply that is not JSON');
  const unread = replies
    .filter((r) => r && r.id === null)
    .map((r) => r.error)
    .sort();
  if (JSON.stringify(unread) !== JSON.stringify(['bad-json', 'too-large']))
    problems.push(`lines it could not read answered ${JSON.stringify(unread)}`);
  const byId = new Map(replies.filter((r) => r && r.id !== null).map((r) => [r.id, r]));
  const expect = (id, test, what) => {
    if (!test(byId.get(id)))
      problems.push(`request ${String(id)}: ${what}, got ${JSON.stringify(byId.get(id) ?? null)}`);
  };
  expect(3, (r) => r?.ok === false && r.error === 'unknown-op', 'unknown-op');
  expect(4, (r) => r?.ok === false && r.error === 'not-loaded', 'not-loaded');
  expect(
    5,
    (r) => r?.ok === false && ['tokenizer-unreadable', 'translated'].includes(r.error),
    'tokenizer-unreadable',
  );
  expect(6, (r) => r?.ok === true, 'cancel answered');
  expect(7, (r) => r?.ok === true, 'quit answered');
  if (code !== 0) problems.push(`exit ${String(code)}`);
  return { passed: problems.length === 0, problems };
}

/**
 * Run the probe against one program (an Intel copy through `arch -x86_64`). Cancel and quit go only once the model
 * request is answered: a cancel refuses whatever is still queued, by design.
 */
export function probeTranslate(command, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const lines = probeLines();
    let out = '';
    let rest = false;
    child.stdout.on('data', (d) => {
      out += d.toString();
      if (!rest && /"id":5,/u.test(out)) {
        rest = true;
        child.stdin.end(`${lines.slice(5).join('\n')}\n`);
      }
    });
    child.stderr.on('data', () => undefined);
    child.stdin.on('error', () => undefined);
    child.stdin.write(`${lines.slice(0, 5).join('\n')}\n`);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ ...judgeProbe(out, code), output: out });
    });
  });
}
