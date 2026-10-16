import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createWriteStream, statfsSync, type WriteStream } from 'node:fs';
import { setPriority } from 'node:os';
import { dirname } from 'node:path';
import { placeName, type StreamPreset } from '../../../shared/stream';
import { redact } from '../redact';
import { audioArgs, type EncoderChoice, encoderCandidates, pickEncoder, videoArgs } from './encoders';
import type { MkvCluster } from './mkv';
import { AUDIO_TRACK, MkvSplitter, MkvWriter, retimeCluster, VIDEO_TRACK } from './mkv';
import { type Progress, ProgressReader } from './progress';
import type { FromProgram, WorkerLive, WorkerRecording, WorkerStatus } from './protocol';
import { ffmpegEnv } from './ffmpeg-env';
import { SoundMeter } from './sound-meter';

/*
 * The stream's pipeline, in the worker process:
 *
 *   the Program's frames and sound ──► FFmpeg encodes once (H.264 + AAC)
 *                                         │ Matroska, cluster by cluster
 *                       ┌─────────────────┴───────────────┐
 *                the recording file               FFmpeg sends it on
 *                (written here; a dropped         (copying, not encoding)
 *                 connection never touches it)    to YouTube over RTMPS;
 *                                                 started again when it stops
 *
 * Frames are counted against the sound: one frame for every 1/30 s of
 * sound, so pictures and sound share one clock for as long as it runs. When
 * no sound comes (the page stalls), a clock here keeps it going with
 * silence. Nothing waits in memory without a limit: a frame the encoder
 * cannot take is dropped, and so is a cluster the connection cannot take
 * (until the next keyframe), and both are counted.
 */

export interface PipelineHooks {
  status(status: WorkerStatus): void;
  log(level: 'info' | 'warn', message: string): void;
  /** Tests: each line the connection's FFmpeg says, as it says it (before anything is hidden). */
  connectionLine?(line: string): void;
  /** Free bytes on the disk holding this folder (a stand-in in tests; the disk's own figure otherwise). */
  freeBytes?(dir: string): number | null;
}

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
/** The encoder's input may hold this much before frames are dropped (about 10 frames at 1080p). */
const ENCODER_BACKLOG = 32 * 1024 * 1024;
/** The connection may fall this far behind (about 10 s at 6 Mbps) before clusters are dropped. */
const PUSH_BACKLOG = 8 * 1024 * 1024;
/** Behind by more than this is "struggling". */
const PUSH_STRUGGLING = 1.5 * 1024 * 1024;
/** The recording's disk may be this far behind before the recording stops (rather than fill memory). */
const RECORD_BACKLOG = 256 * 1024 * 1024;
/** Waits before connecting again: longer each time, up to about 30 s. */
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15_000, 30_000];
/** A connection that lasted this long counts as working: the next drop starts the waits again. */
const STEADY_MS = 30_000;

export function reconnectDelay(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] ?? 30_000;
}

/** Lower priority than the show: streaming must never slow a slide change. */
function belowNormal(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    setPriority(pid, 10);
  } catch {
    // Not allowed here: it runs at normal priority.
  }
}

/** Something written to a stream, without waiting: how far behind it is. */
const backlog = (s: { writableLength: number } | null | undefined) => s?.writableLength ?? 0;

/** Interleaved 32-bit float sound as numbers, without a copy unless its bytes sit at an odd place. */
function floats(pcm: Buffer, frames: number): Float32Array {
  const count = Math.min(Math.floor(pcm.length / 4), frames * CHANNELS);
  if (pcm.byteOffset % 4 === 0) return new Float32Array(pcm.buffer, pcm.byteOffset, count);
  const copy = new Float32Array(count);
  for (let i = 0; i < count; i++) copy[i] = pcm.readFloatLE(i * 4);
  return copy;
}

/** One place the encoded stream goes (the recording, or the connection): it waits for a keyframe, then takes every cluster. */
export interface Consumer {
  started: boolean;
  /** The first cluster's time, so it starts at 0. */
  offset: number;
  /** It fell behind: clusters are dropped until a picture starts one, then it goes on (see consumerTake). */
  skipping: boolean;
}

export const newConsumer = (): Consumer => ({ started: false, offset: 0, skipping: false });

const pictureStart = (c: MkvCluster) => c.startsPicture;

/**
 * What to give a consumer of the encoder's next cluster: at its first picture, the stream's header
 * and that cluster at time 0; then each cluster, its time counted from there. After it fell behind
 * (skipping), nothing until a picture starts a cluster, then on in the same timeline: a gap where
 * clusters were dropped, never a second header or a time going back. Session 15 found the connection
 * sent the header again and its times from 0 after falling behind, and FFmpeg then held every
 * packet's time where it had been: the stream froze. null: nothing to give yet.
 */
export function consumerTake(
  consumer: Consumer,
  cluster: MkvCluster,
  header: Buffer | null,
): Buffer[] | null {
  if (!consumer.started) {
    if (!pictureStart(cluster) || !header) return null;
    consumer.started = true;
    consumer.skipping = false;
    consumer.offset = cluster.timestamp;
    return [header, retimeCluster(cluster, 0)];
  }
  if (consumer.skipping) {
    if (!pictureStart(cluster)) return null;
    consumer.skipping = false;
  }
  return [retimeCluster(cluster, cluster.timestamp - consumer.offset)];
}

/** A plain-language reason the connection stopped, from FFmpeg's last words (already without the key). */
export function connectionMessage(lastLines: readonly string[], name = 'YouTube'): string {
  const text = lastLines.join(' ').toLowerCase();
  // First: FFmpeg also says "input/output error" after a certificate it could not check (OpenSSL on a
  // Mac, GnuTLS on Windows).
  if (
    /certificate verify failed|unable to get local issuer|self[- ]signed certificate|certificate has expired|certificate is not yet valid|peer certificate failed verification|unable to verify peer certificate/u.test(
      text,
    )
  )
    return 'The stream server’s certificate could not be checked, so nothing was sent. Check that this computer’s date and time are right.';
  if (/(resolve|name or service|getaddrinfo|nodename)/u.test(text))
    return `This computer cannot find ${name}’s address: the internet may be down.`;
  if (/(timed out|timeout)/u.test(text)) return `The connection to ${name} timed out.`;
  if (/(refused)/u.test(text)) return `${capital(name)} refused the connection.`;
  if (/(broken pipe|reset by peer|end of file|i\/o error|input\/output error)/u.test(text))
    return `The connection to ${name} dropped.`;
  if (/(tls|ssl|certificate|handshake)/u.test(text)) return `The secure connection to ${name} failed.`;
  if (/(unauthorized|forbidden|403|401)/u.test(text))
    return `${capital(name)} did not accept the stream key.`;
  return `The connection to ${name} stopped.`;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * FFmpeg's arguments for sending the encoded stream (Matroska on its input) to
 * an address. A secure address (rtmps://) is checked against this authorities
 * file when there is one (macOS: the system's; see ../tls.ts).
 */
export function connectionArgs(url: string, key: string, caFile: string | null): string[] {
  const secure = /^rtmps:\/\//iu.test(url) && caFile !== null;
  return [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-nostats',
    '-progress',
    'pipe:2',
    '-stats_period',
    '1',
    '-f',
    'matroska',
    '-i',
    'pipe:0',
    '-map',
    '0',
    '-c',
    'copy',
    '-f',
    'flv',
    '-flvflags',
    'no_duration_filesize',
    // A connection that goes quiet for 10 s is treated as dropped.
    '-rw_timeout',
    '10000000',
    ...(secure ? ['-ca_file', caFile] : []),
    // The key apart from the address (Session 28, decision 17): FFmpeg names the address in what it says,
    // so the key never shows there. It is still on FFmpeg's command line, which other programs on this
    // computer can read while it is live (the admin guide says so).
    '-rtmp_playpath',
    key,
    url.replace(/\/+$/u, ''),
  ];
}

const offLive = (): WorkerLive => ({
  state: 'off',
  since: null,
  health: 'off',
  bitrateKbps: null,
  speed: null,
  backlogBytes: 0,
  reconnects: 0,
  retryAt: null,
  message: null,
});

/** One place the stream goes and its own connection (Session 28: up to three, from one encode). */
class Connection {
  pusher: ChildProcessWithoutNullStreams | null = null;
  consumer: Consumer | null = null;
  progress: Progress | null = null;
  startedAt = 0;
  lines: string[] = [];
  attempts = 0;
  retryTimer: NodeJS.Timeout | null = null;
  live: WorkerLive = offLive();

  constructor(
    readonly id: string,
    readonly url: string,
    readonly key: string,
    readonly name: string,
  ) {}
}

export class StreamPipeline {
  private ffmpeg = '';
  /** The certificate authorities a secure connection is checked against (null: FFmpeg's own). */
  private caFile: string | null = null;
  private preset: StreamPreset | null = null;
  private encoder: EncoderChoice | null = null;
  private encoderName: string | null = null;
  private encodeProcess: ChildProcessWithoutNullStreams | null = null;
  private writer: MkvWriter | null = null;
  private header: Buffer | null = null;
  private format: { width: number; height: number; format: 'I420' | 'NV12' | 'BGRA' | 'RGBA' } | null = null;
  private lastFrame: Buffer | null = null;
  private samples = 0;
  private frames = 0;
  private lastAudioAt = 0;
  private silenceTimer: NodeJS.Timeout | null = null;
  private statusTimer: NodeJS.Timeout | null = null;
  private stopping = false;
  private encodeProgress: Progress | null = null;
  private dropped = 0;
  private error: string | null = null;
  private keys: string[] = [];

  // ---- going live: each place's own connection, the profile's own first (none: not live)
  private connections: Connection[] = [];

  // ---- recording
  private recordFile: WriteStream | null = null;
  private recordConsumer: Consumer | null = null;
  /**
   * The encoder stopped while recording: the recording goes on in a new file
   * once the encoder is back and has a picture (its new stream has a header
   * of its own), and not before. When Drashti itself goes down, the encoder
   * is often the first to go, and a file made in that moment would be left
   * behind as an empty extra part.
   */
  private rollWaiting = false;
  private keepFree = 2 * 1024 ** 3;
  private recording: WorkerRecording = {
    state: 'off',
    file: null,
    since: null,
    bytes: 0,
    rate: null,
    freeBytes: null,
    message: null,
  };
  private bytesSeen: { at: number; bytes: number }[] = [];
  /** How loud what the encoder is given is, and how long it has been quiet (No sound, Session 31). */
  private readonly meter = new SoundMeter(SAMPLE_RATE, CHANNELS);

  constructor(private readonly hooks: PipelineHooks) {}

  private log(level: 'info' | 'warn', message: string): void {
    this.hooks.log(level, redact(message, this.keys));
  }

  status(): WorkerStatus {
    return {
      encoder: this.encoder ? { ...this.encoder } : null,
      encoding: this.encodeProcess !== null,
      fps: this.encodeProgress?.fps ?? null,
      droppedFrames: this.dropped + (this.encodeProgress?.dropFrames ?? 0),
      live: this.redacted(this.overallLive()),
      destinations: this.connections.map((c) => ({ id: c.id, name: c.name, ...this.redacted(c.live) })),
      recording: { ...this.recording },
      error: this.error,
      quietMs: this.meter.quietMs(),
    };
  }

  private report(): void {
    this.hooks.status(this.status());
  }

  /** Get ready: the encoder is found now, and starts with the first frame. */
  async start(options: {
    ffmpeg: string;
    platform: NodeJS.Platform;
    preset: StreamPreset;
    encoder: string | null;
    caFile: string | null;
  }): Promise<void> {
    this.ffmpeg = options.ffmpeg;
    this.caFile = options.caFile;
    this.preset = options.preset;
    this.encoderName = options.encoder;
    this.statusTimer ??= setInterval(() => {
      this.tick();
    }, 1000);
    const known = options.encoder
      ? (encoderCandidates(options.platform).find((c) => c.name === options.encoder) ?? null)
      : null;
    this.encoder = known ?? (await pickEncoder(options.ffmpeg, options.platform, options.preset));
    if (!this.encoder) {
      this.error = 'No H.264 encoder works on this computer, so it cannot stream or record.';
      this.log('warn', this.error);
    } else this.log('info', `Encoder: ${this.encoder.label}`);
    this.report();
    this.maybeStartEncoder();
  }

  // ---- frames and sound in ------------------------------------------------------------

  /** A message from the stream's page. */
  fromProgram(message: FromProgram): void {
    if (this.stopping) return;
    if (message.kind === 'format') {
      const next = { width: message.width, height: message.height, format: message.format };
      if (this.format && JSON.stringify(this.format) !== JSON.stringify(next) && this.encodeProcess) {
        // A new size (another preset): the encoder starts again.
        this.log('info', 'The Program changed size: the encoder starts again');
        this.restartEncoder();
      }
      this.format = next;
      this.maybeStartEncoder();
      return;
    }
    if (message.kind === 'video') {
      // A frame that is not the size announced (a capture being replaced) is not handed on.
      const f = this.format;
      const expected = f ? f.width * f.height * (f.format === 'I420' || f.format === 'NV12' ? 1.5 : 4) : -1;
      if (message.data.byteLength !== expected) return;
      this.lastFrame = Buffer.from(message.data);
      this.maybeStartEncoder();
      return;
    }
    this.lastAudioAt = Date.now();
    this.writeAudio(Buffer.from(message.data), message.frames);
  }

  private maybeStartEncoder(): void {
    if (
      this.encodeProcess ||
      !this.encoder ||
      !this.preset ||
      !this.format ||
      !this.lastFrame ||
      this.stopping
    )
      return;
    if (this.connections.length === 0 && this.recording.state === 'off') return;
    this.startEncoder();
  }

  private startEncoder(): void {
    const preset = this.preset;
    const format = this.format;
    const encoder = this.encoder;
    if (!preset || !format || !encoder) return;
    this.writer = new MkvWriter(
      { ...format, fps: preset.fps },
      { sampleRate: SAMPLE_RATE, channels: CHANNELS },
    );
    this.samples = 0;
    this.frames = 0;
    this.header = null;
    const args = [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-nostats',
      '-progress',
      'pipe:2',
      '-stats_period',
      '1',
      '-f',
      'matroska',
      '-i',
      'pipe:0',
      '-map',
      '0:v:0',
      '-map',
      '0:a:0',
      ...videoArgs(encoder.name, preset),
      ...audioArgs(preset),
      '-f',
      'matroska',
      'pipe:1',
    ];
    const child = spawn(this.ffmpeg, args, { stdio: 'pipe', windowsHide: true, env: ffmpegEnv() });
    belowNormal(child.pid);
    this.encodeProcess = child;
    this.log(
      'info',
      `Encoding started (${encoder.label}, ${preset.width}x${preset.height}, ${preset.videoKbps} kbps)`,
    );
    // This encoder's own reader: what an encoder that has been replaced still writes reaches nobody.
    const splitter = new MkvSplitter(
      (header) => {
        if (this.encodeProcess === child) this.header = header;
      },
      (cluster) => {
        if (this.encodeProcess === child) this.toConsumers(cluster);
      },
    );
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.encodeProcess !== child) return;
      try {
        splitter.push(chunk);
      } catch (error) {
        this.log('warn', `The encoder's output could not be read: ${String(error)}`);
        this.restartEncoder();
      }
    });
    const lines: string[] = [];
    const reader = new ProgressReader(
      (p) => {
        this.encodeProgress = p;
      },
      (line) => {
        lines.push(line);
        if (lines.length > 20) lines.shift();
        this.log('warn', `[encoder] ${line}`);
      },
    );
    child.stderr.on('data', (chunk: Buffer) => {
      reader.push(chunk.toString());
    });
    child.stdin.on('error', () => undefined);
    child.on('error', (error) => {
      this.log('warn', `The encoder could not start: ${error.message}`);
    });
    child.on('exit', (code) => {
      if (this.encodeProcess !== child) return;
      this.encodeProcess = null;
      if (this.stopping) return;
      this.log('warn', `The encoder stopped (code ${String(code)}); starting it again`);
      this.holdRecording();
      this.reconnectForNewEncoder();
      setTimeout(() => {
        this.maybeStartEncoder();
      }, 1000);
    });
    child.stdin.write(this.writer.header());
    // Sound keeps the clock; without any for a moment, silence takes its place.
    this.lastAudioAt = Date.now();
    this.silenceTimer ??= setInterval(() => {
      this.fillSilence();
    }, 50);
  }

  private restartEncoder(): void {
    const child = this.encodeProcess;
    this.encodeProcess = null;
    child?.stdin.end();
    child?.kill();
    this.holdRecording();
    this.reconnectForNewEncoder();
    this.maybeStartEncoder();
  }

  /**
   * The encoder started again: its pictures start a new timeline (and may have new settings), which
   * a connection already sending cannot take in the middle of its stream. So the connection starts
   * again too, at once, and YouTube sees a short reconnection.
   */
  private reconnectForNewEncoder(): void {
    for (const c of this.connections) {
      const child = c.pusher;
      if (!child) continue;
      c.pusher = null;
      c.consumer = null;
      child.stdin.end();
      setTimeout(() => {
        child.kill();
      }, 3000).unref();
      if (this.stopping) continue;
      this.log(
        'info',
        this.connections.length > 1
          ? `The encoder started again, and so does the connection to ${c.name}`
          : 'The encoder started again, and so does the connection',
      );
      this.connect(c);
    }
  }

  private writeAudio(pcm: Buffer, frames: number): void {
    const child = this.encodeProcess;
    const writer = this.writer;
    const preset = this.preset;
    if (!child || !writer || !preset) return;
    if (backlog(child.stdin) > ENCODER_BACKLOG * 2) return;
    for (const part of writer.block(AUDIO_TRACK, this.samples / SAMPLE_RATE, pcm)) child.stdin.write(part);
    this.samples += frames;
    this.meter.add(floats(pcm, frames), frames);
    // One frame for every 1/fps s of sound.
    const due = Math.floor((this.samples * preset.fps) / SAMPLE_RATE);
    while (this.frames < due) {
      const frame = this.lastFrame;
      if (frame && backlog(child.stdin) < ENCODER_BACKLOG) {
        for (const part of writer.block(VIDEO_TRACK, this.frames / preset.fps, frame))
          child.stdin.write(part);
      } else if (frame) this.dropped++;
      this.frames++;
    }
  }

  /** No sound for a moment (the page stalled, or has none): silence keeps time. */
  private fillSilence(): void {
    if (!this.encodeProcess) return;
    const quiet = Date.now() - this.lastAudioAt;
    if (quiet < 300) return;
    const frames = Math.round((quiet * SAMPLE_RATE) / 1000);
    this.lastAudioAt = Date.now();
    for (let left = frames; left > 0; left -= 4800) {
      const n = Math.min(4800, left);
      this.writeAudio(Buffer.alloc(n * CHANNELS * 4), n);
    }
  }

  // ---- out ------------------------------------------------------------------------------

  private toConsumers(cluster: MkvCluster): void {
    // A recording held while the encoder was down goes on, in a new file, from the new encoder's first picture.
    if (this.rollWaiting && this.header && pictureStart(cluster)) {
      this.rollWaiting = false;
      this.rollRecording();
    }
    if (this.recordConsumer && this.recordFile) {
      const out = consumerTake(this.recordConsumer, cluster, this.header);
      if (out) this.writeRecording(out);
    }
    // Each place on its own: one falling behind never holds another (or the recording) up.
    for (const c of this.connections) {
      const consumer = c.consumer;
      if (!consumer || !c.pusher) continue;
      const stdin = c.pusher.stdin;
      if (backlog(stdin) > PUSH_BACKLOG) {
        // Too far behind: drop until the next keyframe, the times going on, and count what is lost
        // (a cluster is ~0.1 s).
        consumer.skipping = true;
        this.dropped += Math.max(1, Math.round((this.preset?.fps ?? 30) / 10));
        continue;
      }
      const starting = !consumer.started;
      const resuming = consumer.skipping;
      const out = consumerTake(consumer, cluster, this.header);
      if (out) {
        const to = this.connections.length > 1 ? ` to ${c.name}` : '';
        if (starting) this.log('info', `Sending${to}, from a keyframe`);
        else if (resuming) this.log('info', `Sending${to} again, from a keyframe, after falling behind`);
        for (const part of out) stdin.write(part);
      }
    }
  }

  // ---- recording -----------------------------------------------------------------------

  record(file: string, keepFreeBytes: number): void {
    this.stopRecording();
    this.keepFree = keepFreeBytes;
    const free = this.freeBytes(file);
    if (free !== null && free < keepFreeBytes) {
      this.recording = { ...this.recording, state: 'off', message: this.lowSpace(free) };
      this.report();
      return;
    }
    this.openRecording(file);
    this.maybeStartEncoder();
    this.report();
  }

  private openRecording(file: string): void {
    const out = createWriteStream(file, { flags: 'wx' });
    out.on('error', (error) => {
      this.log('warn', `The recording could not be written: ${error.message}`);
      this.stopRecording('The recording stopped: the file could not be written.');
    });
    this.recordFile = out;
    this.recordConsumer = newConsumer();
    this.recording = {
      state: 'recording',
      file,
      since: this.recording.state === 'recording' ? this.recording.since : Date.now(),
      bytes: 0,
      rate: null,
      freeBytes: this.freeBytes(file),
      message: null,
    };
    this.bytesSeen = [];
    this.log('info', 'Recording started');
  }

  /** The encoder is down: the recording's file is finished, and the next one waits for the encoder (rollWaiting). */
  private holdRecording(): void {
    if (!this.recordFile) return;
    this.recordFile.end();
    this.recordFile = null;
    this.recordConsumer = null;
    this.rollWaiting = true;
  }

  /** The encoder started again: the recording carries on in a new file beside the old one. */
  private rollRecording(): void {
    const file = this.recording.file;
    if (!file) return;
    this.recordFile?.end();
    const next = file.replace(/( part \d+)?\.mkv$/u, '') + ` part ${Date.now() % 100000}.mkv`;
    this.openRecording(next);
  }

  private writeRecording(parts: Buffer[]): void {
    const out = this.recordFile;
    if (!out) return;
    if (backlog(out) > RECORD_BACKLOG) {
      this.stopRecording('The recording stopped: the disk could not keep up.');
      return;
    }
    for (const part of parts) {
      out.write(part);
      this.recording.bytes += part.length;
    }
  }

  stopRecording(message?: string): void {
    const held = this.rollWaiting;
    this.rollWaiting = false;
    if (!this.recordFile && !held) {
      if (message) this.recording.message = message;
      return;
    }
    this.recordFile?.end();
    this.recordFile = null;
    this.recordConsumer = null;
    this.recording = { ...this.recording, state: 'off', rate: null, message: message ?? null };
    this.log('info', message ? `Recording stopped: ${message}` : 'Recording stopped');
    this.quietIfIdle();
    this.report();
  }

  private freeBytes(file: string): number | null {
    if (this.hooks.freeBytes) return this.hooks.freeBytes(dirname(file));
    try {
      const s = statfsSync(dirname(file));
      return s.bavail * s.bsize;
    } catch {
      return null;
    }
  }

  private lowSpace(free: number): string {
    const gb = (free / 1024 ** 3).toFixed(1);
    return `The recording stopped: only ${gb} GB is free on that disk, and Drashti keeps 2 GB free. The stream goes on.`;
  }

  // ---- going live -----------------------------------------------------------------------

  goLive(url: string, key: string, more: readonly { id: string; url: string; key: string }[] = []): void {
    // Asked again (the worker started again): each place starts afresh, keeping when it first went on air.
    const before = new Map(this.connections.map((c) => [c.id, c.live.since]));
    for (const c of this.connections) this.drop(c);
    // One place is YouTube's, as ever; with several, each is called by its address (Session 28).
    const several = more.length > 0;
    this.connections = [
      new Connection('', url, key, several ? placeName(url) : 'YouTube'),
      ...more.map((m) => new Connection(m.id, m.url, m.key, placeName(m.url))),
    ];
    this.keys = this.connections.map((c) => c.key);
    for (const c of this.connections) {
      c.live = {
        ...offLive(),
        state: 'connecting',
        since: before.get(c.id) ?? null,
        health: 'reconnecting',
        message: `Connecting to ${c.name}…`,
      };
      this.connect(c);
    }
    this.maybeStartEncoder();
    this.report();
  }

  private connect(c: Connection): void {
    if (!this.connections.includes(c) || this.stopping) return;
    c.retryTimer = null;
    c.lines = [];
    c.progress = null;
    const child = spawn(this.ffmpeg, connectionArgs(c.url, c.key, this.caFile), {
      stdio: 'pipe',
      windowsHide: true,
      env: ffmpegEnv(),
    });
    belowNormal(child.pid);
    c.pusher = child;
    c.consumer = newConsumer();
    c.startedAt = Date.now();
    const to = this.connections.length > 1 ? ` to ${c.name}` : '';
    this.log('info', `Connecting${to} (try ${c.attempts + 1})`);
    child.stdout.resume();
    const reader = new ProgressReader(
      (p) => {
        // A connection that has been replaced (or ended) no longer speaks for the stream.
        if (c.pusher !== child) return;
        c.progress = p;
        if ((p.totalSize ?? 0) > 0 && c.live.state !== 'live') {
          c.live = {
            ...c.live,
            state: 'live',
            since: c.live.since ?? Date.now(),
            health: 'good',
            retryAt: null,
            message: null,
          };
          this.log('info', this.connections.length > 1 ? `On air on ${c.name}` : 'On air');
          this.report();
        }
      },
      (line) => {
        this.hooks.connectionLine?.(line);
        const safe = redact(line, this.keys);
        c.lines.push(safe);
        if (c.lines.length > 20) c.lines.shift();
        this.log('warn', `[connection${to}] ${safe}`);
      },
    );
    child.stderr.on('data', (chunk: Buffer) => {
      reader.push(chunk.toString());
    });
    child.stdin.on('error', () => undefined);
    child.on('error', (error) => {
      this.log('warn', `The connection${to} could not start: ${error.message}`);
    });
    child.on('exit', () => {
      if (c.pusher !== child) return;
      c.pusher = null;
      c.consumer = null;
      if (!this.connections.includes(c) || this.stopping) return;
      this.scheduleReconnect(c);
    });
  }

  private scheduleReconnect(c: Connection): void {
    if (Date.now() - c.startedAt > STEADY_MS) c.attempts = 0;
    const wait = reconnectDelay(c.attempts);
    c.attempts++;
    const reason = connectionMessage(c.lines, c.name);
    const at = Date.now() + wait;
    c.live = {
      ...c.live,
      state: 'reconnecting',
      health: 'reconnecting',
      reconnects: c.live.reconnects + 1,
      retryAt: at,
      message: `${reason} Trying again in ${Math.round(wait / 1000)} s (try ${c.attempts}).`,
      bitrateKbps: null,
      speed: null,
    };
    this.log('warn', `${reason} Trying again in ${Math.round(wait / 1000)} s`);
    this.report();
    c.retryTimer = setTimeout(() => {
      c.live = { ...c.live, retryAt: null, message: `Connecting to ${c.name} again…` };
      this.connect(c);
      this.report();
    }, wait);
  }

  /** A place's connection ends (no reconnecting): its pusher finishes and goes. */
  private drop(c: Connection): void {
    if (c.retryTimer) clearTimeout(c.retryTimer);
    c.retryTimer = null;
    const child = c.pusher;
    c.pusher = null;
    c.consumer = null;
    if (child) {
      child.stdin.end();
      setTimeout(() => {
        child.kill();
      }, 3000).unref();
    }
  }

  endLive(): void {
    if (this.connections.length === 0) return;
    const all = this.connections;
    this.connections = [];
    for (const c of all) this.drop(c);
    this.log('info', 'The stream ended');
    this.quietIfIdle();
    this.report();
  }

  /** Neither on air nor recording: the sound's quiet count starts afresh next time (No sound). */
  private quietIfIdle(): void {
    if (this.connections.length === 0 && this.recording.state === 'off') this.meter.reset();
  }

  /** A live status without the keys in its words. */
  private redacted(live: WorkerLive): WorkerLive {
    return { ...live, message: live.message ? redact(live.message, this.keys) : null };
  }

  /**
   * All the places together: with one, just its own; with several (Session 28), on air while any is (the
   * operator sees n of m), its health struggling while one is not, and the words of those that are not.
   */
  private overallLive(): WorkerLive {
    const all = this.connections;
    if (all.length <= 1) return all[0]?.live ?? offLive();
    const lives = all.map((c) => c.live);
    const on = lives.filter((l) => l.state === 'live');
    const down = all.filter((c) => c.live.state !== 'live');
    const state: WorkerLive['state'] =
      on.length > 0
        ? 'live'
        : lives.some((l) => l.state === 'reconnecting')
          ? 'reconnecting'
          : lives.some((l) => l.state === 'connecting')
            ? 'connecting'
            : 'off';
    const since = lives.reduce<number | null>(
      (first, l) => (l.since !== null && (first === null || l.since < first) ? l.since : first),
      null,
    );
    const health: WorkerLive['health'] =
      state === 'live'
        ? down.length > 0 || on.some((l) => l.health === 'struggling')
          ? 'struggling'
          : 'good'
        : state === 'off'
          ? 'off'
          : 'reconnecting';
    const retries = lives.map((l) => l.retryAt).filter((t): t is number => t !== null);
    const speeds = on.map((l) => l.speed).filter((v): v is number => v !== null);
    const message =
      down.length > 0
        ? down.map((c) => c.live.message ?? `${capital(c.name)} is not on air.`).join(' ')
        : (on.find((l) => l.message !== null)?.message ?? null);
    return {
      state,
      since,
      health,
      bitrateKbps: on.length > 0 ? on.reduce((n, l) => n + (l.bitrateKbps ?? 0), 0) : null,
      speed: speeds.length > 0 ? Math.min(...speeds) : null,
      backlogBytes: Math.max(0, ...lives.map((l) => l.backlogBytes)),
      reconnects: lives.reduce((n, l) => n + l.reconnects, 0),
      retryAt: retries.length > 0 ? Math.min(...retries) : null,
      message,
    };
  }

  // ---- every second ------------------------------------------------------------------------

  private tick(): void {
    // Each connection's health, from FFmpeg's progress and what is waiting to go out.
    for (const c of this.connections) {
      if (c.live.state !== 'live' || !c.pusher) continue;
      const waiting = backlog(c.pusher.stdin);
      const speed = c.progress?.speed ?? null;
      const struggling = waiting > PUSH_STRUGGLING || (speed !== null && speed < 0.9);
      c.live = {
        ...c.live,
        health: struggling ? 'struggling' : 'good',
        bitrateKbps: c.progress?.bitrateKbps ?? null,
        speed,
        backlogBytes: waiting,
        message: struggling
          ? this.connections.length > 1
            ? `The connection to ${c.name} is too slow for this preset: try the weak-internet preset.`
            : 'The connection is too slow for this preset: try the weak-internet preset.'
          : null,
      };
    }
    // The recording: how fast it grows, the disk's free space, and the time left.
    if (this.recordFile && this.recording.file) {
      const now = Date.now();
      this.bytesSeen.push({ at: now, bytes: this.recording.bytes });
      while ((this.bytesSeen[0]?.at ?? now) < now - 10_000) this.bytesSeen.shift();
      const first = this.bytesSeen[0];
      const rate =
        first && now > first.at ? ((this.recording.bytes - first.bytes) * 1000) / (now - first.at) : null;
      const free = this.freeBytes(this.recording.file);
      this.recording = { ...this.recording, rate, freeBytes: free };
      if (free !== null && free < this.keepFree) this.stopRecording(this.lowSpace(free));
    }
    this.report();
  }

  /** Stop everything (the worker then exits). */
  stop(): void {
    this.stopping = true;
    this.endLive();
    this.stopRecording();
    if (this.silenceTimer) clearInterval(this.silenceTimer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    const child = this.encodeProcess;
    this.encodeProcess = null;
    child?.stdin.end();
    if (child)
      setTimeout(() => {
        child.kill();
      }, 3000).unref();
  }

  /** The encoder in use (for the main process to remember). */
  get encoderInUse(): string | null {
    return this.encoder?.name ?? this.encoderName;
  }
}
