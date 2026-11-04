import { _electron, expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/* Real browser audio and preload/Main ports, without a model or a recording. Chromium supplies a generated tone.
 * A DOM MessageChannel alone misses Electron's rejection of a transferred PCM ArrayBuffer (payload becomes null).
 */
test('browser microphone PCM reaches Main intact through the preload port', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-speech-port-'));
  const bundle = join(dir, 'speech-tap.js');
  const worklet = join(dir, 'speech-worklet.js');
  const workletSource = join(process.cwd(), 'src/renderer/src/program/speech-worklet.ts');
  await build({
    entryPoints: [workletSource],
    outfile: worklet,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    logLevel: 'silent',
  });
  await build({
    plugins: [
      {
        name: 'native-worklet-url',
        setup(build) {
          build.onResolve({ filter: /speech-worklet\.ts\?worker&url$/ }, () => ({
            path: 'speech-worklet-url',
            namespace: 'fixture',
          }));
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: "export default '/speech-worklet.js'",
            loader: 'js',
          }));
        },
      },
    ],
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
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
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
    if (request.url === '/speech-worklet.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(readFileSync(worklet));
    } else if (request.url === '/speech-tap.js') {
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
  const env: Record<string, string> = { PCM_PROBE_URL: `http://127.0.0.1:${String(address.port)}/` };
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  const app = await _electron.launch({ args: [bootstrap], env });
  try {
    const page = await app.firstWindow();
    await page.evaluate(async () => {
      interface Tap {
        speechPort(
          port: MessagePort | null,
          track: () => MediaStreamTrack | null,
          graph: () => { context: AudioContext; source: AudioNode; sink: AudioNode } | null,
        ): void;
      }
      const tap = (globalThis as unknown as { DrashtiSpeechTap: Tap }).DrashtiSpeechTap;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const context = new AudioContext({ sampleRate: 48_000 });
      const source = context.createMediaStreamSource(stream);
      const sink = context.createMediaStreamDestination();
      source.connect(sink);
      const state = globalThis as unknown as { tapDisconnects: number };
      state.tapDisconnects = 0;
      const disconnect = source.disconnect.bind(source);
      Object.defineProperty(source, 'disconnect', {
        value: (destination?: AudioNode) => {
          state.tapDisconnects++;
          if (destination) disconnect(destination);
          else disconnect();
        },
      });
      await context.resume();
      window.addEventListener('message', (event: MessageEvent<{ speechPort?: boolean }>) => {
        if (event.source === window && event.data.speechPort === true && event.ports[0])
          tap.speechPort(
            event.ports[0],
            () => stream.getAudioTracks()[0] ?? null,
            () => ({ context, source, sink }),
          );
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
    // Drawing/encoding must not turn two seconds of microphone input into a few isolated fragments.
    const before = (await receipt()).samples;
    await page.evaluate(async () => {
      for (let i = 0; i < 4; i += 1) {
        const until = performance.now() + 400;
        while (performance.now() < until) {
          /* generated renderer load */
        }
        // eslint-disable-next-line no-restricted-syntax -- the measured load deliberately stalls for 400 ms, then lets capture run for 100 ms
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
    });
    expect((await receipt()).samples - before).toBeGreaterThanOrEqual(24_000);
    await app.evaluate(() => (globalThis as unknown as { pcmPort: { close(): void } }).pcmPort.close());
    await expect
      .poll(() => page.evaluate(() => (globalThis as unknown as { tapDisconnects: number }).tapDisconnects))
      .toBe(1);
    expect(await page.evaluate(() => document.querySelectorAll('audio').length)).toBe(0);
  } finally {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
