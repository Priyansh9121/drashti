import { describe, expect, it } from 'vitest';
import { parseXml } from '../xml';
import { readDeckSlide, stepsOf } from './pptx-deck';

function parallel(id: number, condition: string, children: string, attributes = ''): string {
  return `<p:par><p:cTn id="${id}"${attributes ? ` ${attributes}` : ''}><p:stCondLst>${condition}</p:stCondLst><p:childTnLst>${children}</p:childTnLst></p:cTn></p:par>`;
}

const delay = (ms: number | 'indefinite') => `<p:cond delay="${ms}"/>`;
const onEnd = (id: number, ms: number) => `<p:cond evt="onEnd" delay="${ms}"><p:tn val="${id}"/></p:cond>`;

function behaviour(
  name: string,
  shapeId: number,
  durationMs: number,
  attributes = '',
  textTarget = '',
): string {
  return `<p:${name}${attributes ? ` ${attributes}` : ''}><p:cBhvr><p:cTn id="${shapeId + 100}" dur="${durationMs}"/><p:tgtEl><p:spTgt spid="${shapeId}">${textTarget}</p:spTgt></p:tgtEl></p:cBhvr></p:${name}>`;
}

function read(groups: string): ReturnType<typeof readDeckSlide> {
  const slide = parseXml(
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree/></p:cSld><p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst><p:seq><p:cTn id="2" nodeType="mainSeq"><p:childTnLst>${groups}</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing></p:sld>`,
  );
  return readDeckSlide(slide, new Map(), { cx: 12_192_000, cy: 6_858_000 });
}

describe('PowerPoint slide animation timing', () => {
  it('starts With Previous siblings at their own delays, then starts the next After Previous group', () => {
    const fade = (
      id: number,
      shape: number,
      start: number,
      type: 'clickEffect' | 'withEffect' | 'afterEffect',
    ) =>
      parallel(
        id,
        delay(start),
        behaviour('animEffect', shape, 200, 'filter="fade" transition="in"'),
        `nodeType="${type}" presetClass="entr" presetID="10"`,
      );
    // Office puts effects that start together in one inner par. Each delay is relative to that par.
    const delayed = parallel(
      10,
      delay('indefinite'),
      parallel(11, delay(0), fade(12, 2, 500, 'clickEffect') + fade(13, 3, 0, 'withEffect')),
    );
    const staggered = parallel(
      20,
      delay('indefinite'),
      parallel(
        21,
        delay(0),
        fade(22, 4, 0, 'clickEffect') +
          fade(23, 5, 200, 'withEffect') +
          fade(24, 6, 400, 'withEffect') +
          fade(25, 7, 600, 'withEffect'),
      ) + parallel(26, delay(800), fade(27, 8, 100, 'afterEffect') + fade(28, 9, 0, 'withEffect')),
    );
    const slide = read(delayed + staggered);
    expect(slide.groups.map((group) => group.lengthMs)).toEqual([700, 1100]);
    expect(slide.motion?.approximate).toBe(false);
    expect(slide.motion?.effects.map(({ shapeId, step, delayMs }) => [shapeId, step, delayMs])).toEqual([
      ['3', 1, 0],
      ['2', 1, 500],
      ['4', 2, 0],
      ['5', 2, 200],
      ['6', 2, 400],
      ['7', 2, 600],
      ['9', 2, 800],
      ['8', 2, 900],
    ]);
  });

  it('reads all four diagonal Fly paths from their edge coordinates for entrance and exit', () => {
    const directions = [
      { subtype: '3', x: 'right', y: 'up' },
      { subtype: '6', x: 'right', y: 'down' },
      { subtype: '9', x: 'left', y: 'up' },
      { subtype: '12', x: 'left', y: 'down' },
    ] as const;
    const coordinates = {
      left: '0-#ppt_w/2',
      right: '1+#ppt_w/2',
      up: '0-#ppt_h/2',
      down: '1+#ppt_h/2',
    } as const;
    const opposite = { left: 'right', right: 'left', up: 'down', down: 'up' } as const;
    const examples = directions.flatMap((edge) =>
      (['in', 'out'] as const).map((phase) => ({ ...edge, phase })),
    );
    const groups = examples
      .map(({ subtype, x, y, phase }, index) => {
        const id = index * 10 + 10;
        const shape = index + 2;
        const position = (property: 'ppt_x' | 'ppt_y', outside: string, clockId: number) => {
          const inside = `#${property}`;
          const [from, to] = phase === 'in' ? [outside, inside] : [inside, outside];
          return behaviour('anim', shape, 400, 'calcmode="lin"')
            .replace(`id="${shape + 100}"`, `id="${clockId}"`)
            .replace(
              '</p:cBhvr>',
              `<p:attrNameLst><p:attrName>${property}</p:attrName></p:attrNameLst></p:cBhvr>`,
            )
            .replace(
              '</p:anim>',
              `<p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="${to}"/></p:val></p:tav></p:tavLst></p:anim>`,
            );
        };
        return parallel(
          id,
          delay('indefinite'),
          parallel(
            id + 1,
            delay(0),
            parallel(
              id + 2,
              delay(0),
              position('ppt_x', coordinates[x], id + 3) + position('ppt_y', coordinates[y], id + 4),
              `nodeType="clickEffect" presetClass="${phase === 'in' ? 'entr' : 'exit'}" presetID="2" presetSubtype="${subtype}"`,
            ),
          ),
        );
      })
      .join('');
    expect(read(groups).motion).toMatchObject({
      approximate: false,
      effects: examples.map(({ phase, x, y }, index) => ({
        shapeId: String(index + 2),
        step: index + 1,
        phase,
        kind: 'fly',
        direction: phase === 'in' ? opposite[x] : x,
        verticalDirection: phase === 'in' ? opposite[y] : y,
        delayMs: 0,
        durationMs: 400,
      })),
    });
    expect(read(groups.replace('1+#ppt_w/2', '#ppt_x+0.08')).motion?.approximate).toBe(true);
  });

  it('uses the fade clock and accepts only the matching visibility bookkeeping', () => {
    const clip = (phase: 'in' | 'out', setAt: number, property = 'style.visibility') => {
      const set = behaviour('set', 2, 1)
        .replace('id="102" dur="1"/>', `id="103" dur="1"><p:stCondLst>${delay(setAt)}</p:stCondLst></p:cTn>`)
        .replace(
          '</p:cBhvr>',
          `<p:attrNameLst><p:attrName>${property}</p:attrName></p:attrNameLst></p:cBhvr>`,
        )
        .replace(
          '</p:set>',
          `<p:to><p:strVal val="${phase === 'in' ? 'visible' : 'hidden'}"/></p:to></p:set>`,
        );
      const fade = behaviour('animEffect', 2, 300, `filter="fade" transition="${phase}"`).replace(
        'dur="300"/>',
        `dur="300"><p:stCondLst>${delay(50)}</p:stCondLst></p:cTn>`,
      );
      return read(
        parallel(
          10,
          delay('indefinite'),
          parallel(
            11,
            delay(0),
            parallel(
              12,
              delay(0),
              set + fade,
              `nodeType="clickEffect" presetClass="${phase === 'in' ? 'entr' : 'exit'}" presetID="10"`,
            ),
          ),
        ),
      ).motion;
    };
    for (const [phase, setAt] of [
      ['in', 50],
      ['out', 349],
    ] as const) {
      expect(clip(phase, setAt)).toMatchObject({
        approximate: false,
        effects: [{ kind: 'fade', phase, delayMs: 50, durationMs: 300 }],
      });
      expect(clip(phase, 0)?.approximate).toBe(true);
      expect(clip(phase, setAt, 'style.opacity')?.approximate).toBe(true);
    }
  });

  it('reads the gallery Zoom, Float, Split and symmetric Grow/Shrink with their durations, keeping PowerPoint’s video for all but the Zoom', () => {
    const click = (id: number, preset: string, cls: 'entr' | 'exit' | 'emph', children: string) =>
      parallel(
        id,
        delay('indefinite'),
        parallel(
          id + 1,
          delay(0),
          parallel(
            id + 2,
            delay(0),
            children,
            `nodeType="clickEffect" presetClass="${cls}" presetID="${preset}"`,
          ),
        ),
      );
    const withFade = (shape: number, durationMs: number, direction: 'in' | 'out') =>
      behaviour('animEffect', shape, durationMs, `filter="fade" transition="${direction}"`).replace(
        `id="${shape + 100}"`,
        `id="${shape + 200}"`,
      );
    const float = (shape: number, direction: 'in' | 'out') => {
      const [from, to] = direction === 'in' ? ['#ppt_y+0.08', '#ppt_y'] : ['#ppt_y', '#ppt_y-0.08'];
      return (
        behaviour('anim', shape, 450)
          .replace('</p:cBhvr>', '<p:attrNameLst><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr>')
          .replace(
            '</p:anim>',
            `<p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="${to}"/></p:val></p:tav></p:tavLst></p:anim>`,
          ) + withFade(shape, 450, direction)
      );
    };
    const zoom =
      behaviour('animScale', 2, 300).replace(
        '</p:animScale>',
        '<p:from x="0" y="0"/><p:to x="100000" y="100000"/></p:animScale>',
      ) + withFade(2, 300, 'in');
    const split = behaviour('animEffect', 5, 500, 'filter="barn(outVertical)" transition="in"');
    const grow = behaviour('animScale', 6, 600).replace(
      '</p:animScale>',
      '<p:by x="150000" y="150000"/></p:animScale>',
    );
    const slide = read(
      click(10, '53', 'entr', zoom) +
        click(20, '42', 'entr', float(3, 'in')) +
        click(30, '47', 'exit', float(4, 'out')) +
        click(40, '16', 'entr', split) +
        click(50, '6', 'emph', grow),
    );
    // Only the gallery Zoom has been compared with PowerPoint's own movie (12 Nov): the others are drawn by Drashti
    // where no video can be made, and keep PowerPoint's video wherever one can be.
    expect(read(click(10, '53', 'entr', zoom)).motion?.approximate).toBe(false);
    for (const [preset, cls, children] of [
      ['42', 'entr', float(3, 'in')],
      ['47', 'exit', float(4, 'out')],
      ['16', 'entr', split],
      ['6', 'emph', grow],
    ] as const)
      expect(read(click(20, preset, cls, children)).motion?.approximate).toBe(true);
    expect(slide.motion).toMatchObject({
      approximate: true,
      effects: [
        { shapeId: '2', step: 1, phase: 'in', kind: 'zoom', fade: true, durationMs: 300 },
        {
          shapeId: '3',
          step: 2,
          phase: 'in',
          kind: 'float',
          direction: 'up',
          distance: 0.08,
          durationMs: 450,
        },
        {
          shapeId: '4',
          step: 3,
          phase: 'out',
          kind: 'float',
          direction: 'up',
          distance: 0.08,
          durationMs: 450,
        },
        { shapeId: '5', step: 4, phase: 'in', kind: 'split', splitAxis: 'x', durationMs: 500 },
        { shapeId: '6', step: 5, phase: 'emphasis', kind: 'grow-shrink', scale: 1.5, durationMs: 600 },
      ],
    });
  });

  /** One click with one effect of these behaviours, read as a slide of its own. */
  const alone = (preset: string, cls: 'entr' | 'exit' | 'emph', children: string, attributes = '') =>
    read(
      parallel(
        10,
        delay('indefinite'),
        parallel(
          11,
          delay(0),
          parallel(
            12,
            delay(0),
            children,
            `nodeType="clickEffect" presetClass="${cls}" presetID="${preset}"${attributes ? ` ${attributes}` : ''}`,
          ),
        ),
      ),
    ).motion;
  /** A linear track of one property, its values as PowerPoint writes them (a number or a formula). */
  const track = (
    shape: number,
    clock: number,
    property: string,
    from: string,
    to: string,
    ms = 500,
    timing = '',
  ) =>
    `<p:anim calcmode="lin" valueType="num"><p:cBhvr><p:cTn id="${String(clock)}" dur="${String(ms)}" fill="hold"${timing}/><p:tgtEl><p:spTgt spid="${String(shape)}"/></p:tgtEl><p:attrNameLst><p:attrName>${property}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val>${from}</p:val></p:tav><p:tav tm="100000"><p:val>${to}</p:val></p:tav></p:tavLst></p:anim>`;
  const number = (value: number) => `<p:fltVal val="${String(value)}"/>`;
  const formula = (value: string) => `<p:strVal val="${value}"/>`;
  const fadeOf = (shape: number, clock: number, direction: 'in' | 'out', ms = 500) =>
    `<p:animEffect transition="${direction}" filter="fade"><p:cBhvr><p:cTn id="${String(clock)}" dur="${String(ms)}"/><p:tgtEl><p:spTgt spid="${String(shape)}"/></p:tgtEl></p:cBhvr></p:animEffect>`;
  const filtered = (shape: number, filter: string, direction: 'in' | 'out' = 'in', ms = 500) =>
    `<p:animEffect transition="${direction}" filter="${filter}"><p:cBhvr><p:cTn id="${String(shape + 300)}" dur="${String(ms)}"/><p:tgtEl><p:spTgt spid="${String(shape)}"/></p:tgtEl></p:cBhvr></p:animEffect>`;

  it('reads the gallery Zoom as PowerPoint writes it, its width and height growing from the number 0', () => {
    const zoom =
      track(2, 21, 'ppt_w', number(0), formula('#ppt_w')) +
      track(2, 22, 'ppt_h', number(0), formula('#ppt_h')) +
      fadeOf(2, 23, 'in');
    expect(alone('53', 'entr', zoom)).toMatchObject({
      approximate: false,
      effects: [{ shapeId: '2', phase: 'in', kind: 'zoom', fade: true, scale: 0, durationMs: 500 }],
    });
  });

  it('turns Grow & Turn and Shrink & Turn while they scale and fade, keeping PowerPoint’s video where one can be made', () => {
    const turn = (direction: 'in' | 'out') => {
      const [small, full] =
        direction === 'in' ? [number(0), formula('#ppt_w')] : [formula('#ppt_w'), number(0)];
      const [tall, high] =
        direction === 'in' ? [number(0), formula('#ppt_h')] : [formula('#ppt_h'), number(0)];
      const [turned, upright] = direction === 'in' ? [number(90), number(0)] : [number(0), number(90)];
      return (
        track(2, 21, 'ppt_w', small, full) +
        track(2, 22, 'ppt_h', tall, high) +
        track(2, 23, 'style.rotation', turned, upright) +
        fadeOf(2, 24, direction)
      );
    };
    for (const [direction, cls] of [
      ['in', 'entr'],
      ['out', 'exit'],
    ] as const)
      expect(alone('31', cls, turn(direction))).toMatchObject({
        approximate: true,
        effects: [{ phase: direction, kind: 'zoom', fade: true, scale: 0, degrees: 90, durationMs: 500 }],
      });
  });

  it('plays Split in from both edges as well as out from the middle, keeping PowerPoint’s video where one can be made', () => {
    expect(alone('16', 'entr', filtered(2, 'barn(inVertical)'))).toMatchObject({
      approximate: true,
      effects: [{ kind: 'split', splitAxis: 'x', inward: true, durationMs: 500 }],
    });
    expect(alone('16', 'exit', filtered(2, 'barn(inHorizontal)', 'out'))).toMatchObject({
      approximate: true,
      effects: [{ phase: 'out', kind: 'split', splitAxis: 'y', inward: true }],
    });
  });

  it('plays a smooth start and smooth end, the effect’s own or the one its behaviours share, keeping PowerPoint’s video where one can be made', () => {
    const fly = (timing: string, own = '') =>
      alone(
        '2',
        'entr',
        track(2, 21, 'ppt_x', formula('#ppt_x'), formula('#ppt_x'), 500, timing) +
          track(2, 22, 'ppt_y', formula('1+#ppt_h/2'), formula('#ppt_y'), 500, timing),
        `presetSubtype="4"${own}`,
      );
    // The same Fly without a smooth start or end is played exactly; with one, not yet compared with PowerPoint's own
    // movie, Drashti plays it where no video can be made.
    expect(fly('')).toMatchObject({ approximate: false, effects: [{ kind: 'fly', direction: 'up' }] });
    expect(fly('')?.effects[0]).not.toHaveProperty('decel');
    expect(fly(' decel="100000"')).toMatchObject({
      approximate: true,
      effects: [{ kind: 'fly', direction: 'up', decel: 1 }],
    });
    expect(fly('', ' accel="25000" decel="50000"')).toMatchObject({
      approximate: true,
      effects: [{ kind: 'fly', accel: 0.25, decel: 0.5 }],
    });
    expect(fly(' decel="100000"', ' accel="50000"')?.approximate).toBe(true);
  });

  it('draws Shape, Wheel, Random Bars and Bounce, keeping PowerPoint’s video where one can be made', () => {
    expect(alone('6', 'entr', filtered(2, 'circle(out)'))).toMatchObject({
      approximate: true,
      effects: [{ kind: 'shape', shape: 'circle', durationMs: 500 }],
    });
    expect(alone('6', 'exit', filtered(2, 'diamond(in)', 'out'))).toMatchObject({
      approximate: true,
      effects: [{ phase: 'out', kind: 'shape', shape: 'diamond', inward: true }],
    });
    expect(alone('21', 'entr', filtered(2, 'wheel(4)'))).toMatchObject({
      approximate: true,
      effects: [{ kind: 'wheel', spokes: 4 }],
    });
    expect(alone('14', 'entr', filtered(2, 'randombar(horizontal)'))).toMatchObject({
      approximate: true,
      effects: [{ kind: 'bars', bars: 'horizontal' }],
    });
    const bounce =
      filtered(2, 'wipe(down)', 'in', 580) +
      track(2, 21, 'ppt_x', formula('#ppt_x-0.25'), formula('#ppt_x'), 1822) +
      track(2, 22, 'ppt_y', formula('#ppt_y-0.25'), formula('#ppt_y'), 664);
    expect(alone('26', 'entr', bounce)).toMatchObject({
      approximate: true,
      effects: [{ kind: 'bounce', delayMs: 0, durationMs: 1822 }],
    });
  });

  it('keeps the click, whole shape, parallel delays, and previous end for each effect', () => {
    const automatic = parallel(
      10,
      '<p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>',
      parallel(
        11,
        delay(120),
        behaviour('animEffect', 2, 350, 'filter="fade" transition="in"'),
        'nodeType="withEffect" presetClass="entr" presetID="10"',
      ),
    );
    const first = parallel(
      20,
      delay('indefinite'),
      parallel(
        21,
        delay(0),
        parallel(
          22,
          delay(0),
          behaviour('set', 3, 1),
          'nodeType="clickEffect" presetClass="entr" presetID="1"',
        ) +
          parallel(
            23,
            delay(80),
            behaviour('anim', 4, 400),
            'nodeType="withEffect" presetClass="entr" presetID="2" presetSubtype="4"',
          ),
      ) +
        parallel(
          24,
          onEnd(23, 120),
          parallel(
            25,
            delay(0),
            behaviour('animEffect', 5, 300, 'filter="wipe(left)" transition="in"'),
            'nodeType="afterEffect" presetClass="entr" presetID="22"',
          ) +
            parallel(
              26,
              delay(200),
              behaviour('animScale', 6, 150),
              'nodeType="withEffect" presetClass="entr" presetID="23"',
            ),
        ),
    );
    const second = parallel(
      30,
      delay('indefinite'),
      parallel(
        31,
        delay(45),
        behaviour('animRot', 6, 240, 'by="10800000"'),
        'nodeType="clickEffect" presetClass="emph" presetID="8"',
      ) +
        parallel(
          32,
          onEnd(106, 50),
          behaviour('animEffect', 2, 300, 'filter="fade" transition="out"'),
          'nodeType="afterEffect" presetClass="exit" presetID="10"',
        ),
    );
    const slide = read(automatic + first + second);
    expect(stepsOf(slide.groups)).toBe(3);
    expect(slide).toMatchObject({
      motion: {
        approximate: false,
        effects: [
          { shapeId: '2', step: 0, phase: 'in', kind: 'fade', delayMs: 120, durationMs: 350 },
          { shapeId: '3', step: 1, phase: 'in', kind: 'appear', delayMs: 0, durationMs: 0 },
          { shapeId: '4', step: 1, phase: 'in', kind: 'fly', direction: 'up', delayMs: 80, durationMs: 400 },
          {
            shapeId: '5',
            step: 1,
            phase: 'in',
            kind: 'wipe',
            direction: 'left',
            delayMs: 600,
            durationMs: 300,
          },
          { shapeId: '6', step: 1, phase: 'in', kind: 'zoom', delayMs: 800, durationMs: 150 },
          {
            shapeId: '6',
            step: 2,
            phase: 'emphasis',
            kind: 'spin',
            degrees: 180,
            delayMs: 45,
            durationMs: 240,
          },
          { shapeId: '2', step: 2, phase: 'out', kind: 'fade', delayMs: 335, durationMs: 300 },
        ],
      },
    });
  });

  it('shows and hides each paragraph of a paragraph build at its own click, never before', () => {
    const click = (id: number, phase: 'in' | 'out', index: number) =>
      parallel(
        id,
        delay('indefinite'),
        parallel(
          id + 1,
          delay(0),
          parallel(
            id + 2,
            delay(0),
            behaviour(
              'animEffect',
              3,
              250,
              `filter="fade" transition="${phase}"`,
              `<p:txEl><p:pRg st="${index}" end="${index}"/></p:txEl>`,
            ).replace('id="103"', `id="${id + 3}"`),
            `nodeType="clickEffect" presetClass="${phase === 'in' ? 'entr' : 'exit'}" presetID="10"`,
          ),
        ),
      );
    const slide = read(click(10, 'in', 0) + click(20, 'in', 1) + click(30, 'out', 0) + click(40, 'out', 1));
    expect(stepsOf(slide.groups)).toBe(5);
    // Still PowerPoint's video where one can be made: Drashti fades each paragraph by itself.
    expect(slide.motion).toMatchObject({
      approximate: true,
      effects: [
        { shapeId: '3', step: 1, phase: 'in', kind: 'fade', durationMs: 250, paragraphs: [0, 0] },
        { shapeId: '3', step: 2, phase: 'in', kind: 'fade', durationMs: 250, paragraphs: [1, 1] },
        { shapeId: '3', step: 3, phase: 'out', kind: 'fade', durationMs: 250, paragraphs: [0, 0] },
        { shapeId: '3', step: 4, phase: 'out', kind: 'fade', durationMs: 250, paragraphs: [1, 1] },
      ],
    });
  });

  it('keeps a word-by-word or letter-by-letter build for PowerPoint’s video', () => {
    const effect = parallel(
      10,
      delay('indefinite'),
      parallel(
        11,
        delay(0),
        behaviour('animEffect', 3, 400, 'filter="fade" transition="in"'),
        'nodeType="clickEffect" presetClass="entr" presetID="10"',
      ).replace(
        '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>',
        '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:iterate type="lt"><p:tmPct val="10000"/></p:iterate><p:childTnLst>',
      ),
    );
    expect(effect).toContain('<p:iterate');
    expect(read(effect).motion).toMatchObject({
      approximate: true,
      effects: [{ shapeId: '3', kind: 'fade' }],
    });
  });

  it('flags unsupported effects for a baked slide and preserves a whole-shape fallback at its click', () => {
    const first = parallel(
      20,
      delay('indefinite'),
      parallel(
        21,
        delay(35),
        behaviour('animMotion', 2, 650, 'path="M 0 0 L 1 1 E"'),
        'nodeType="clickEffect" presetClass="path" presetID="0"',
      ),
    );
    const second = parallel(
      30,
      delay('indefinite'),
      parallel(
        31,
        delay(0),
        behaviour(
          'animEffect',
          3,
          250,
          'filter="fade" transition="in"',
          '<p:txEl><p:pRg st="0" end="0"/></p:txEl>',
        ),
        'nodeType="clickEffect" presetClass="entr" presetID="10"',
      ) +
        parallel(
          32,
          delay(50),
          behaviour('animEffect', 4, 430, 'filter="checkerboard(across)" transition="in"'),
          'nodeType="withEffect" presetClass="entr" presetID="5"',
        ),
    );
    const slide = read(first + second);
    expect(stepsOf(slide.groups)).toBe(3);
    expect(slide).toMatchObject({
      motion: {
        approximate: true,
        effects: [
          { shapeId: '2', step: 1, phase: 'emphasis', kind: 'pulse', delayMs: 35, durationMs: 650 },
          { shapeId: '3', step: 2, phase: 'in', kind: 'fade', delayMs: 0, durationMs: 250 },
          { shapeId: '4', step: 2, phase: 'in', kind: 'fade', delayMs: 50, durationMs: 430 },
        ],
      },
    });
  });
});
