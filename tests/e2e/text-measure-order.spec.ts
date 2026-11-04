import { _electron, expect, test } from '@playwright/test';
import { buildSync } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/* The profiled hot path: passive overset metadata must not force synchronous layout for every show revision.
 * Shrink-to-fit and a real editor/thumbnail measurement still have to finish during the layout commit.
 */
test('passive text measurement leaves the commit free, while fit and editor reports stay immediate', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-text-measure-'));
  const bundle = join(dir, 'probe.js');
  const entry = `import React,{useRef,useLayoutEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {useShrinkToFit} from ${JSON.stringify(join(process.cwd(), 'src/renderer/src/render/SlideView.tsx'))};
import {MeasureContext} from ${JSON.stringify(join(process.cwd(), 'src/renderer/src/render/measure.tsx'))};
const getHeight=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'offsetHeight').get;
let reads=0;
Object.defineProperty(HTMLElement.prototype,'offsetHeight',{configurable:true,get(){if(this.dataset.measureWords==='yes')reads++;return getHeight.call(this)}});
globalThis.runTextMeasure=async(on,reporting)=>{
 reads=0;let calls=0,snapshot;const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const done=new Promise(resolve=>{
  function Probe(){const box=useRef(null),words=useRef(null);useShrinkToFit(box,words,{id:'placeholder-text',style:{shrinkToFit:on}});
   useLayoutEffect(()=>{snapshot={readsAtCommit:reads,reportsAtCommit:calls};resolve()});
   return <div ref={box} data-measure-box="yes" style={{width:160,height:16,overflow:'hidden'}}><div ref={words} data-measure-words="yes" style={{fontSize:'calc(24px * var(--fit, 1))',lineHeight:1.1}}>Placeholder words for a narrow box. Placeholder words for a narrow box.</div></div>
  }
  root.render(reporting?<MeasureContext.Provider value={()=>{calls++}}><Probe/></MeasureContext.Provider>:<Probe/>);
 });
 await done;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 const box=host.querySelector('[data-measure-box]');const result={...snapshot,over:box.hasAttribute('data-overset'),fit:box.getAttribute('data-fit')};root.unmount();host.remove();return result;
};`;
  buildSync({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' },
    outfile: bundle,
    bundle: true,
    platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  const bootstrap = join(dir, 'main.cjs');
  writeFileSync(
    bootstrap,
    `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(dir, 'profile'))});if(process.platform==='darwin')app.setActivationPolicy('accessory');app.focus=()=>{};app.whenReady().then(()=>{const w=new BrowserWindow({width:640,height:360,show:false,webPreferences:{backgroundThrottling:false}});w.setOpacity(0);w.setIgnoreMouseEvents(true);w.webContents.setAudioMuted(true);w.showInactive();w.loadURL(process.env.TEXT_MEASURE_URL);});`,
  );
  const server = createServer((request, response) => {
    if (request.url === '/probe.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(readFileSync(bundle));
    } else {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<!doctype html><title>Placeholder text measure</title><body><script>globalThis.fixtureErrors=[];addEventListener("error",e=>fixtureErrors.push(e.message));</script><script src="/probe.js"></script>',
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No private text fixture listener');
  const env: Record<string, string> = { TEXT_MEASURE_URL: `http://127.0.0.1:${String(address.port)}/` };
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  const app = await _electron.launch({ args: [bootstrap], env });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('load');
    expect(
      await page.evaluate(() => (globalThis as unknown as { fixtureErrors: string[] }).fixtureErrors),
    ).toEqual([]);
    await expect
      .poll(() =>
        page.evaluate(() => typeof (globalThis as unknown as { runTextMeasure?: unknown }).runTextMeasure),
      )
      .toBe('function');
    const run = (on: boolean, reporting: boolean) =>
      page.evaluate(
        async ({ on, reporting }) =>
          (
            globalThis as unknown as {
              runTextMeasure(
                on: boolean,
                reporting: boolean,
              ): Promise<{
                readsAtCommit: number;
                reportsAtCommit: number;
                over: boolean;
                fit: string | null;
              }>;
            }
          ).runTextMeasure(on, reporting),
        { on, reporting },
      );
    const plain = await run(false, false);
    expect(plain.readsAtCommit).toBe(0);
    expect(plain.over).toBe(true);
    expect(plain.fit).toBeNull();
    const fit = await run(true, false);
    expect(fit.readsAtCommit).toBeGreaterThan(0);
    expect(fit.fit).not.toBeNull();
    expect(Number(fit.fit)).toBeGreaterThan(0);
    expect(Number(fit.fit)).toBeLessThan(1);
    expect(fit.over).toBe(false);
    const editor = await run(false, true);
    expect(editor.readsAtCommit).toBeGreaterThan(0);
    expect(editor.reportsAtCommit).toBeGreaterThan(0);
    expect(editor.over).toBe(true);
  } finally {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
