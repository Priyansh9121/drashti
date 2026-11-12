import { editablePptxFixture, slideXml, wordsShape } from '../testing/editable-pptx-fixture';

/** Generated PowerPoint slides exercising each imported click effect without Office. */
export function nativeDeckFixture(unsupported = false): Buffer {
  const words = (id: number, text: string, x: number, y: number) =>
    wordsShape(
      `<a:p><a:r><a:rPr sz="2700"/><a:t>${text}</a:t></a:r></a:p>`,
      `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="3657600" cy="640080"/></a:xfrm>`,
    ).replace('id="2"', `id="${id}"`);
  const parallel = (id: number, children: string, condition: string, attributes = '') =>
    `<p:par><p:cTn id="${id}" ${attributes}><p:stCondLst>${condition}</p:stCondLst><p:childTnLst>${children}</p:childTnLst></p:cTn></p:par>`;
  const delay = (ms: number | 'indefinite') => `<p:cond delay="${ms}"/>`;
  const click = (id: number, children: string) => parallel(id, children, delay('indefinite'));
  const effect = (
    id: number,
    target: number,
    preset: string,
    mode: 'withEffect' | 'clickEffect' | 'afterEffect',
    className: 'entr' | 'exit' | 'emph',
    behavior: string,
    duration: number,
    offset = 0,
    behaviorAttrs = '',
    subtype = '',
  ) =>
    parallel(
      id,
      `<p:${behavior} ${behaviorAttrs}><p:cBhvr><p:cTn id="${id + 100}" dur="${duration}"/><p:tgtEl><p:spTgt spid="${target}"/></p:tgtEl></p:cBhvr></p:${behavior}>`,
      delay(offset),
      `nodeType="${mode}" presetClass="${className}" presetID="${preset}" ${subtype}`,
    );
  const first =
    effect(21, 2, '1', 'clickEffect', 'entr', 'set', 1) +
    effect(22, 3, '2', 'withEffect', 'entr', 'anim', 400, 80, '', 'presetSubtype="4"');
  const wipe = effect(
    31,
    4,
    '22',
    'clickEffect',
    'entr',
    'animEffect',
    300,
    30,
    'filter="wipe(right)" transition="in"',
  );
  // Basic Zoom, growing from nothing where the shape stands.
  const zoom = effect(32, 5, '23', 'afterEffect', 'entr', 'animScale', 250, 40).replace(
    '</p:animScale>',
    '<p:from x="0" y="0"/><p:to x="100000" y="100000"/></p:animScale>',
  );
  // PowerPoint starts a new sub-group after the Wipe's 30 ms delay and 300 ms run.
  const second = parallel(33, wipe, delay(0)) + parallel(34, zoom, delay(330));
  const third =
    effect(41, 5, '8', 'clickEffect', 'emph', 'animRot', 300, 0, 'by="21600000"') +
    effect(42, 2, '10', 'withEffect', 'exit', 'animEffect', 200, 30, 'filter="fade" transition="out"');
  const automatic = parallel(
    10,
    parallel(
      12,
      effect(11, 6, '10', 'withEffect', 'entr', 'animEffect', 180, 80, 'filter="fade" transition="in"'),
      delay(0),
    ),
    `${delay('indefinite')}<p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>`,
  );
  const groups =
    automatic +
    click(20, parallel(23, first, delay(0))) +
    click(30, second) +
    click(40, parallel(43, third, delay(0)));
  const timing = `<p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst><p:seq><p:cTn id="2" nodeType="mainSeq"><p:childTnLst>${groups}</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
  const animated = slideXml(
    words(2, 'Placeholder appear', 914_400, 914_400) +
      words(3, 'Placeholder fly', 914_400, 1_828_800) +
      words(4, 'Placeholder wipe', 914_400, 2_743_200) +
      words(5, 'Placeholder zoom', 914_400, 3_657_600) +
      words(6, 'Placeholder fade', 914_400, 4_572_000),
  ).replace('</p:sld>', `${timing}</p:sld>`);
  const transition = unsupported ? 'checkerboard dir="horz"' : 'wipe dir="u"';
  const last = slideXml(words(2, 'Placeholder next slide', 914_400, 1_828_800)).replace(
    '</p:sld>',
    `<p:transition dur="650"><p:${transition}/></p:transition></p:sld>`,
  );
  return editablePptxFixture({ slides: [animated, last] });
}
