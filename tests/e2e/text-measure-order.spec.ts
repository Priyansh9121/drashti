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
import {StageView} from ${JSON.stringify(join(process.cwd(), 'src/renderer/src/render/StageView.tsx'))};
import {initialEngineState} from ${JSON.stringify(join(process.cwd(), 'src/shared/engine/state.ts'))};
const getHeight=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'offsetHeight').get;
let reads=0;
Object.defineProperty(HTMLElement.prototype,'offsetHeight',{configurable:true,get(){if(this.dataset.measureWords==='yes'||this.parentElement?.dataset.testid==='stage-next'||this.parentElement?.dataset.testid==='stage-current')reads++;return getHeight.call(this)}});
globalThis.runTextMeasure=async(on,reporting)=>{
 reads=0;let calls=0,snapshot,fail;const host=document.createElement('div');document.body.append(host);const root=createRoot(host,{onUncaughtError:e=>fail(e)});
 const done=new Promise((resolve,reject)=>{fail=reject;
  function Probe(){const box=useRef(null),words=useRef(null);useShrinkToFit(box,words,{id:'placeholder-text',style:{shrinkToFit:on}});
   useLayoutEffect(()=>{snapshot={readsAtCommit:reads,reportsAtCommit:calls};resolve()});
   return <div ref={box} data-measure-box="yes" style={{width:160,height:16,overflow:'hidden'}}><div ref={words} data-measure-words="yes" style={{fontSize:'calc(24px * var(--fit, 1))',lineHeight:1.1}}>Placeholder words for a narrow box. Placeholder words for a narrow box.</div></div>
  }
  root.render(reporting?<MeasureContext.Provider value={()=>{calls++}}><Probe/></MeasureContext.Provider>:<Probe/>);
 });
 await done;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 const box=host.querySelector('[data-measure-box]');const result={...snapshot,readsAfterPaint:reads,over:box.hasAttribute('data-overset'),fit:box.getAttribute('data-fit')};root.unmount();host.remove();return result;
};
globalThis.runStageMeasure=async(long)=>{
 reads=0;let snapshot,fail;const host=document.createElement('div');document.body.append(host);const root=createRoot(host,{onUncaughtError:e=>fail(e)});
 const slide={id:'placeholder-stage',width:1920,height:1080,background:null,elements:[{id:'placeholder-words',kind:'text',lang:'en',text:long?'Placeholder river lantern line\\n'.repeat(24):'Placeholder',frame:{x:0,y:0,width:1920,height:1080},opacity:1,rotation:0,style:{fontFamily:null,fontSize:80,fontWeight:400,lineHeight:1.35,color:'#ffffff',align:'center',verticalAlign:'center'}}]};
 const state={...initialEngineState(),next:{kind:'slide',slide}};
 await new Promise((resolve,reject)=>{fail=reject;
  function Probe(){useLayoutEffect(()=>{snapshot={readsAtCommit:reads};resolve()});return <StageView state={state}/>}
  root.render(<Probe/>);
 });
 await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 const box=host.querySelector('[data-testid="stage-next"]'),words=box.firstElementChild;
 const result={...snapshot,readsAfterPaint:reads,fit:box.getAttribute('data-stage-fit'),wordsHeight:getHeight.call(words),boxHeight:box.clientHeight,over:getHeight.call(words)>box.clientHeight+0.5};root.unmount();host.remove();return result;
};`;
  buildSync({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' },
    outfile: bundle,
    bundle: true,
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  const bootstrap = join(dir, 'main.cjs');
  writeFileSync(
    bootstrap,
    `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(dir, 'profile'))});if(process.platform==='darwin')app.setActivationPolicy('accessory');app.focus=()=>{};app.whenReady().then(()=>{const w=new BrowserWindow({width:1280,height:720,show:false,webPreferences:{backgroundThrottling:false}});w.setOpacity(0);w.setIgnoreMouseEvents(true);w.webContents.setAudioMuted(true);w.showInactive();w.loadURL(process.env.TEXT_MEASURE_URL);});`,
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
    page.on('pageerror', (error) => console.log('Text fixture error:', error.message));
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
                readsAfterPaint: number;
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
    expect.soft(plain.readsAfterPaint, 'passive metadata must use sizes supplied by layout').toBe(0);
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
    const stage = (long: boolean) =>
      page.evaluate(
        async (long) =>
          (
            globalThis as unknown as {
              runStageMeasure(long: boolean): Promise<{
                readsAtCommit: number;
                readsAfterPaint: number;
                fit: string | null;
                over: boolean;
              }>;
            }
          ).runStageMeasure(long),
        long,
      );
    const shortStage = await stage(false);
    expect.soft(shortStage.readsAtCommit, 'ordinary stage words must not force layout in the commit').toBe(0);
    expect.soft(shortStage.readsAfterPaint, 'ordinary stage words must use observed layout sizes').toBe(0);
    expect(shortStage.fit).toBeNull();
    expect(shortStage.over).toBe(false);
    const longStage = await stage(true);
    console.log('Stage fit measurements:', { short: shortStage, long: longStage });
    expect.soft(longStage.readsAtCommit, 'long stage words must wait for observed layout').toBe(0);
    expect(Number(longStage.fit)).toBeGreaterThan(0);
    expect(Number(longStage.fit)).toBeLessThan(1);
    expect(longStage.over).toBe(false);
  } finally {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
