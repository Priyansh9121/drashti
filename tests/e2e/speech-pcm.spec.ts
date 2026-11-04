import { _electron, expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/* Real browser audio and preload/Main ports, without a model or a recording. Chromium supplies a generated tone.
 * A DOM MessageChannel alone misses Electron's rejection of a transferred PCM ArrayBuffer (payload becomes null).
 */
test('browser microphone PCM reaches Main intact through the preload port', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-speech-port-'));
  const bundle = join(dir, 'speech-tap.js');
  createRequire(__filename)('esbuild').buildSync({
    entryPoints: [join(process.cwd(), 'src/renderer/src/program/speech-tap.ts')],
    outfile: bundle,
    bundle: true,
    format: 'iife',
    globalName: 'DrashtiSpeechTap',
    platform: 'browser',
    logLevel: 'silent',
  });
  const preload = join(dir, 'preload.cjs');
  writeFileSync(
    preload,
    `const {ipcRenderer}=require('electron');
ipcRenderer.on('speech-port',event=>window.postMessage({speechPort:true},'*',event.ports));`,
  );
  const bootstrap = join(dir, 'main.cjs');
  writeFileSync(
    bootstrap,
    `const {app,BrowserWindow,session,MessageChannelMain}=require('electron');
app.setPath('userData',${JSON.stringify(join(dir, 'profile'))});
if(process.platform==='darwin')app.setActivationPolicy('accessory');
app.focus=()=>{};
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.whenReady().then(()=>{
 session.defaultSession.setPermissionRequestHandler((_w,_p,yes)=>yes(true));
 const w=new BrowserWindow({width:640,height:360,show:false,webPreferences:{backgroundThrottling:false,preload:${JSON.stringify(preload)}}});
 w.setOpacity(0);w.setIgnoreMouseEvents(true);w.webContents.setAudioMuted(true);w.showInactive();
 globalThis.pcmReceipt={messages:0,chunks:0,samples:0,nonSilent:false};
 globalThis.pairPcm=()=>{
  const {port1,port2}=new MessageChannelMain();
  port1.on('message',event=>{
   globalThis.pcmReceipt.messages++;
   const data=event.data;
   if(data?.kind!=='pcm')return;
   const values=data.samples instanceof Int16Array?data.samples:data.samples instanceof ArrayBuffer?new Int16Array(data.samples):null;
   if(!values)return;
   globalThis.pcmReceipt.chunks++;globalThis.pcmReceipt.samples+=values.length;
   if(values.some(v=>v!==0))globalThis.pcmReceipt.nonSilent=true;
  });
  port1.start();globalThis.pcmPort=port1;
  w.webContents.postMessage('speech-port',{},[port2]);
 };
 w.loadURL(process.env.PCM_PROBE_URL);
});`,
  );
  const server = createServer((request, response) => {
    if (request.url === '/speech-tap.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(readFileSync(bundle));
    } else {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<!doctype html><title>Generated microphone fixture</title><script src="/speech-tap.js"></script>',
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No private audio fixture listener');
  const env = { ...process.env, PCM_PROBE_URL: `http://127.0.0.1:${String(address.port)}/` };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ args: [bootstrap], env });
  try {
    const page = await app.firstWindow();
    await page.evaluate(async () => {
      type Tap = { speechPort(port: MessagePort | null, track: () => MediaStreamTrack | null): void };
      const tap = (globalThis as unknown as { DrashtiSpeechTap: Tap }).DrashtiSpeechTap;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      window.addEventListener('message', (event: MessageEvent<{ speechPort?: boolean }>) => {
        if (event.source === window && event.data.speechPort === true && event.ports[0])
          tap.speechPort(event.ports[0], () => stream.getAudioTracks()[0] ?? null);
      });
    });
    await app.evaluate(() => (globalThis as unknown as { pairPcm(): void }).pairPcm());
    const receipt = () =>
      app.evaluate(
        () =>
          (globalThis as unknown as { pcmReceipt: { chunks: number; samples: number; nonSilent: boolean } })
            .pcmReceipt,
      );
    await expect.poll(async () => (await receipt()).samples).toBeGreaterThan(8_000);
    expect((await receipt()).chunks).toBeGreaterThan(0);
    expect((await receipt()).nonSilent).toBe(true);
  } finally {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
