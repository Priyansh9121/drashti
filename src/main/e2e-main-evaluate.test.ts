import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/*
 * The end-to-end tests' calls into Main (alpha.24, a24-nature-hang): Playwright's ElectronApplication.evaluate reaches
 * Main through Node's inspector, which runs the function on a V8 interrupt, in the middle of whatever JavaScript Main
 * is running, Node's own timer code among it. A Node timer started or stopped there (setTimeout, setInterval,
 * clearTimeout, clearInterval) can change Node's heap of timer lists while Node is half-way through changing it, and
 * Main's event loop then spins for good in processTimers on a list that is no longer there: appearance-drawing.spec.ts
 * :279 hung 22 min on CI's Mac (26 Nov, run 45893266393) and 19.5 min on CI's Windows (27 Nov, run 46002096338), Main
 * still answering the inspector ("Quitting" at the timeout) with no timer firing. So each such call does its work on
 * Main's own turn: setImmediate first (its queue is changed only by straight-line code, so an interrupt never lands
 * half-way), or after an await; never a Node timer in the call itself. The test's own waits are unchanged.
 */

const app = join(__dirname, '..', '..');
const TIMERS = new Set(['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval']);
/** Callbacks that run at once, inside the call (a Promise's executor, an array's own methods). */
const AT_ONCE = new Set([
  'forEach',
  'map',
  'filter',
  'some',
  'every',
  'find',
  'findIndex',
  'reduce',
  'flatMap',
]);

/** Every Node timer started or stopped inside a call into Main itself (`file:line name`). */
function timersInMainCalls(file: string, text: string): string[] {
  // Main's handle by its usual name, or any name the file gives an ElectronApplication.
  const names = new Set([
    'app',
    ...[...text.matchAll(/\b(\w+)\s*:\s*ElectronApplication\b/gu)].map((m) => m[1] ?? 'app'),
  ]);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const isFunction = (n: ts.Node): n is ts.ArrowFunction | ts.FunctionExpression =>
    ts.isArrowFunction(n) || ts.isFunctionExpression(n);
  const runsAtOnce = (fn: ts.Node) => {
    const p = fn.parent;
    if (ts.isNewExpression(p)) return ts.isIdentifier(p.expression) && p.expression.text === 'Promise';
    return (
      ts.isCallExpression(p) &&
      ts.isPropertyAccessExpression(p.expression) &&
      AT_ONCE.has(p.expression.name.text)
    );
  };
  const hasAwait = (n: ts.Node): boolean =>
    ts.isAwaitExpression(n) || (!ts.isFunctionLike(n) && (ts.forEachChild(n, hasAwait) ?? false));
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const c = node.expression;
      const name = ts.isIdentifier(c)
        ? c.text
        : ts.isPropertyAccessExpression(c) && c.expression.getText() === 'globalThis'
          ? c.name.text
          : null;
      if (name !== null && TIMERS.has(name))
        found.push(
          `${file}:${String(source.getLineAndCharacterOfPosition(node.getStart()).line + 1)} ${name}`,
        );
    }
    // A function's body runs later (a callback, a handler), unless it runs at once.
    if (ts.isFunctionLike(node) && !(isFunction(node) && runsAtOnce(node))) return;
    ts.forEachChild(node, walk);
  };
  const inCall = (fn: ts.ArrowFunction | ts.FunctionExpression) => {
    if (!ts.isBlock(fn.body)) {
      walk(fn.body);
      return;
    }
    for (const statement of fn.body.statements) {
      walk(statement);
      // After an await the rest runs on a later turn, never inside the call.
      if (hasAwait(statement)) return;
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const { name, expression: on } = node.expression;
      const handle = ts.isIdentifier(on) ? on.text : ts.isPropertyAccessExpression(on) ? on.name.text : null;
      const fn = node.arguments[0];
      if (name.text === 'evaluate' && handle !== null && names.has(handle) && fn && isFunction(fn))
        inCall(fn);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Every .ts file under a folder of the app, by its path from the app. */
function files(dir: string): string[] {
  return readdirSync(join(app, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(app, path)).isDirectory()) return files(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

describe('the end-to-end tests’ calls into Main (a24-nature-hang)', () => {
  it('finds a Node timer started or stopped inside the call itself, and only there', () => {
    const at = (body: string) => timersInMainCalls('x.ts', body);
    expect(at('app.evaluate(() => { setTimeout(() => 1, 0); });')).toEqual(['x.ts:1 setTimeout']);
    expect(at('app.evaluate(() => new Promise((r) => { setInterval(r, 9); }));')).toEqual([
      'x.ts:1 setInterval',
    ]);
    expect(at('node.app.evaluate(() => { clearInterval(g.t); });')).toEqual(['x.ts:1 clearInterval']);
    expect(
      at('f = (o: ElectronApplication) => o.evaluate(() => { [1].forEach(() => clearTimeout(1)); });'),
    ).toEqual(['x.ts:1 clearTimeout']);
    // On Main's own turn, after an await, in a later callback, or in a page: never inside the call into Main.
    expect(
      at('app.evaluate(() => new Promise((r) => { setImmediate(() => { setTimeout(r, 0); }); }));'),
    ).toEqual([]);
    expect(
      at('app.evaluate(async () => { await new Promise((r) => setImmediate(r)); setTimeout(f, 9); });'),
    ).toEqual([]);
    expect(at('app.evaluate(() => { g.stop = () => clearInterval(g.t); });')).toEqual([]);
    expect(at('win.evaluate(() => { setTimeout(f, 0); });')).toEqual([]);
  });

  it('never starts or stops a Node timer inside a call into Main: its work is on Main’s own turn', () => {
    const found = files(join('tests', 'e2e')).flatMap((path) =>
      timersInMainCalls(path.split('\\').join('/'), readFileSync(join(app, path), 'utf8')),
    );
    expect(found).toEqual([]);
  });
});
