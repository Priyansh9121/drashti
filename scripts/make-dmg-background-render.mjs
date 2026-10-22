// Electron's side of scripts/make-dmg-background.mjs: draws the disk image's picture in a window that never
// shows (off screen), with the app's own Noto Sans, at each scale, and writes each picture as a PNG and what
// its words measure as report.json. Started only by make-dmg-background.mjs:
//   electron scripts/make-dmg-background-render.mjs <job.json>
// job.json: { "out": "<folder>", "svg": "<svg ...>", "width": 660, "height": 400,
//             "fonts": [{ "weight": 400, "file": "<.woff2>" }], "pictures": [{ "name": "x.png", "scale": 1 }] }
// The SVG is drawn in the page itself, not as an image: an SVG image draws before its fonts have loaded.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

const job = JSON.parse(readFileSync(process.argv.at(-1) ?? '', 'utf8'));

app.disableHardwareAcceleration();
app.dock?.hide();
// Electron's own files stay in the job's folder, removed with it.
app.setPath('userData', join(job.out, 'electron'));
app.setPath('crashDumps', join(job.out, 'electron', 'crashes'));
// Each picture's window closes before the next one opens: Electron goes on until the last is drawn.
app.on('window-all-closed', () => {});

/** The page: the fonts, as data, then the picture at `scale` times its size in CSS pixels. */
function page(scale) {
  const fonts = job.fonts
    .map(
      ({ weight, file }) =>
        `@font-face{font-family:'Noto Sans';font-weight:${String(weight)};` +
        `src:url(data:font/woff2;base64,${readFileSync(file).toString('base64')}) format('woff2')}`,
    )
    .join('');
  const size = `width:${String(job.width * scale)}px;height:${String(job.height * scale)}px`;
  return `<!doctype html><meta charset="utf-8"><title>picture</title><style>${fonts}html,body{margin:0;overflow:hidden}body>svg{display:block;${size}}</style>${job.svg}`;
}

/** Once every font has loaded and the page has drawn: the fonts, and each word's box (in points). */
const MEASURE = `(async () => {
  await Promise.all(${JSON.stringify(job.fonts.map((f) => f.weight))}.map((w) => document.fonts.load(w + ' 16px "Noto Sans"')));
  await document.fonts.ready;
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  const box = (b) => [b.x, b.y, b.width, b.height].map((v) => Math.round(v * 10) / 10);
  return {
    fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replaceAll('"', '') + ' ' + f.weight),
    words: [...document.querySelectorAll('body > svg text')].map((t) => {
      const chip = t.closest('.chip')?.querySelector('rect');
      return { words: t.textContent, box: box(t.getBBox()), chip: chip ? box(chip.getBBox()) : null };
    }),
  };
})()`;

// Not a top-level await: Electron's ready waits for this module to finish loading.
async function draw() {
  const report = { pictures: [] };
  for (const { name, scale } of job.pictures) {
    const [width, height] = [job.width * scale, job.height * scale];
    const win = new BrowserWindow({
      show: false,
      width,
      height,
      useContentSize: true,
      enableLargerThanScreen: true,
      webPreferences: { offscreen: true, backgroundThrottling: false },
    });
    try {
      // Made, the window may have been fitted to the screen: its size is given again, which then holds.
      const [w, h] = win.getContentSize();
      if (w !== width || h !== height) win.setContentSize(width, height);
      const file = join(job.out, `page-${String(scale)}.html`);
      writeFileSync(file, page(scale));
      await win.loadFile(file);
      const measured = await win.webContents.executeJavaScript(MEASURE);
      // A whole frame drawn after that, twice, the second kept.
      let image = null;
      for (let i = 0; i < 2; i++) {
        const painted = new Promise((done) => {
          win.webContents.once('paint', (_event, _dirty, frame) => done(frame));
        });
        win.webContents.invalidate();
        image = await painted;
      }
      const size = image.getSize();
      if (size.width !== width || size.height !== height)
        throw new Error(
          `${name} came out ${String(size.width)} x ${String(size.height)}, not ${String(width)} x ${String(height)}`,
        );
      writeFileSync(join(job.out, name), image.toPNG());
      report.pictures.push({ name, scale, ...measured });
    } finally {
      win.destroy();
    }
  }
  writeFileSync(join(job.out, 'report.json'), JSON.stringify(report));
}

app
  .whenReady()
  .then(draw)
  .then(
    () => app.quit(),
    (error) => {
      console.error(error);
      app.exit(1);
    },
  );
