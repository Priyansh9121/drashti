// Electron's side of scripts/make-icons.mjs: draws SVGs at exact sizes in a hidden window that never
// shows, and writes each picture as a PNG and as raw RGBA pixels. Started only by make-icons.mjs:
//   electron scripts/make-icons-render.mjs <job.json>
// job.json: { "out": "<folder>", "pictures": [{ "name": "...", "svg": "<svg ...>", "size": 16 }] }
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

const job = JSON.parse(readFileSync(process.argv.at(-1) ?? '', 'utf8'));

app.disableHardwareAcceleration();
app.dock?.hide();

// Not a top-level await: Electron's ready waits for this module to finish loading.
async function draw() {
  const win = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<!doctype html><title>icons</title>');
  for (const { name, svg, size } of job.pictures) {
    const sized = svg.replace(/<svg\b/u, `<svg width="${String(size)}" height="${String(size)}"`);
    const url = `data:image/svg+xml;base64,${Buffer.from(sized).toString('base64')}`;
    const [png, rgba] = await win.webContents.executeJavaScript(`new Promise((done, fail) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = ${String(size)};
        const context = canvas.getContext('2d');
        context.drawImage(img, 0, 0, ${String(size)}, ${String(size)});
        const pixels = context.getImageData(0, 0, ${String(size)}, ${String(size)}).data;
        let text = '';
        for (let i = 0; i < pixels.length; i += 0x8000) text += String.fromCharCode(...pixels.subarray(i, i + 0x8000));
        done([canvas.toDataURL('image/png').split(',')[1], btoa(text)]);
      };
      img.onerror = () => fail(new Error('the SVG could not be drawn'));
      img.src = ${JSON.stringify(url)};
    })`);
    writeFileSync(join(job.out, `${name}.png`), Buffer.from(png, 'base64'));
    writeFileSync(join(job.out, `${name}.rgba`), Buffer.from(rgba, 'base64'));
  }
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
