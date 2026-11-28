import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = () =>
  readFileSync(join(__dirname, '..', 'renderer', 'src', 'ui', 'transient-motion.css'), 'utf8');
const time = (name: string) => {
  const value = new RegExp(`--dur-surface-${name}:\\s*(\\d+)ms;`, 'u').exec(css())?.[1];
  expect(value, `missing surface timing: ${name}`).toBeDefined();
  return Number(value);
};

describe('operator transient motion budgets', () => {
  it('loads the transient stylesheet through the operator entry only', () => {
    const renderer = join(__dirname, '..', 'renderer');
    const stylesheet = 'transient-motion.css';
    const html = readFileSync(join(renderer, 'index.html'), 'utf8');
    expect(html).toContain(`href="./src/ui/${stylesheet}"`);
    for (const name of readdirSync(renderer).filter(
      (name) => name.endsWith('.html') && name !== 'index.html',
    ))
      expect(readFileSync(join(renderer, name), 'utf8'), name).not.toContain(stylesheet);
    for (const name of [
      'ui/transient-motion.ts',
      'ui/Menu.tsx',
      'ui/Tooltip.tsx',
      'ui/Notice.tsx',
      'chat/ChatPop.tsx',
    ])
      expect(readFileSync(join(renderer, 'src', name), 'utf8'), name).not.toContain(stylesheet);
  });

  it('keeps existing exit defaults outside the operator window', () => {
    const text = css().replace(/\/\*[\s\S]*?\*\//gu, '');
    const root = /:root:has\(> body\.operator\)\s*\{([^}]+)\}/u.exec(text)?.[1] ?? '';
    expect(root).toContain('--surface-exit-name: surface-out;');
    expect(root).toContain('--surface-exit-easing: var(--ease-in);');
    for (const name of ['surface-exit-name', 'surface-exit-easing'])
      expect([...text.matchAll(new RegExp(`--${name}:`, 'gu'))]).toHaveLength(1);
    const rules = [...text.matchAll(/([^{}@;]+)\{([^{}]*)\}/gu)].map((m) => ({
      selector: (m[1] ?? '').trim().replace(/\s+/gu, ' '),
      animation: /\banimation:\s*([^;]+);/u.exec(m[2] ?? '')?.[1] ?? '',
    }));
    const exits = rules.filter((r) => r.selector.startsWith('[data-leaving=') && r.animation !== '');
    expect(exits).toHaveLength(4);
    for (const { selector, animation } of exits) {
      expect(animation).toMatch(/var\(--dur-surface-[\w-]+, var\(--dur-exit\)\)/u);
      const sheet = selector.includes("[data-leaving='sheet'] >");
      expect(animation).toContain(`var(--surface-exit-easing, var(--${sheet ? 'ease-drawer' : 'ease-out'}))`);
      if (selector.includes(' >') || selector.includes("[data-leaving='pop']"))
        expect(animation).toContain(`var(--surface-exit-name, ${sheet ? 'sheet-out' : 'drop-out'})`);
      else expect(animation).toMatch(/^fade-out /u);
    }
  });

  it('every Calm entrance, including sheets and the dim, settles within 180 ms', () => {
    for (const name of ['tooltip', 'menu', 'notice', 'dialog', 'scrim', 'sheet']) {
      expect(time(name), name).toBeGreaterThan(0);
      expect(time(name), name).toBeLessThanOrEqual(180);
    }
  });

  it('departures take at most 120 ms and less time than arrivals', () => {
    for (const [entrance, exit] of [
      ['tooltip', 'tooltip-exit'],
      ['menu', 'exit'],
      ['notice', 'exit'],
      ['dialog', 'sheet-exit'],
      ['sheet', 'sheet-exit'],
    ]) {
      expect(time(exit ?? ''), exit).toBeGreaterThan(0);
      expect(time(exit ?? ''), exit).toBeLessThanOrEqual(120);
      expect(time(exit ?? ''), exit).toBeLessThan(time(entrance ?? ''));
    }
  });

  it('animates only opacity and transform, without layout, filter or persistent layer hints', () => {
    const text = css().replace(/\/\*[\s\S]*?\*\//gu, '');
    const frames = [...text.matchAll(/@keyframes\s+[\w-]+\s*\{\s*(?:from|to)\s*\{([^}]+)\}/gu)];
    expect(frames.length).toBeGreaterThanOrEqual(2);
    for (const [, body] of frames) {
      const properties = [...(body ?? '').matchAll(/([\w-]+)\s*:/gu)].map((m) => m[1]);
      expect(properties.filter((p) => p !== 'opacity' && p !== 'transform')).toEqual([]);
    }
    expect(text).not.toMatch(/will-change|translate3d|backdrop-filter|\bfilter\s*:/u);
  });
});

describe('live transient geometry and settled startup', () => {
  it('puts small-surface translation on visual children or the pointer-free tooltip, never live frames', () => {
    const rules = [
      ...css()
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .matchAll(/([^{}@;]+)\{([^{}]*)\}/gu),
    ];
    const small = rules.filter(
      ([_, selector, body]) =>
        /data-motion=['"](?:pop|notice)|motionui-chat-pop|motionui-tooltip/u.test(selector ?? '') &&
        /animation:\s*surface-in/u.test(body ?? ''),
    );
    expect(small.length).toBeGreaterThan(0);
    for (const [, selector] of small) {
      const selectors = (selector ?? '').split(',').map((part) => part.trim());
      for (const part of selectors)
        expect(part, 'only non-interactive visual children may translate').toMatch(
          /(?:\.motionui-visual|> (?:p|svg)|\.motionui-tooltip\[data-motion=['"]pop['"]\])$/u,
        );
    }
    const liveChat = rules.filter(([, selector]) =>
      (selector ?? '').includes('body.operator .motionui-chat-pop'),
    );
    for (const [, , body] of liveChat) {
      expect(body).not.toMatch(/(?:^|;)\s*transform\s*:/u);
      expect(body).not.toMatch(/transition-property:[^;]*transform/u);
    }
  });

  it('requires a latched opening decision for the tooltip and chat entrances', () => {
    const text = css().replace(/\/\*[\s\S]*?\*\//gu, '');
    expect(text).not.toMatch(/body\.operator \.motionui-tooltip\s*\{/u);
    expect(text).not.toMatch(/\.motionui-chat-pop:not\(\[data-leaving\]\)/u);
    expect(text).toContain(".motionui-tooltip[data-motion='pop']");
  });
});
