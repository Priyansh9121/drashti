/*
 * Just enough Matroska (EBML) for the stream:
 *
 * - MkvWriter makes the encoder's input: the Program's raw frames (I420 or
 *   NV12) and its sound (32-bit float, interleaved), each block with its own
 *   time, so FFmpeg keeps them in step.
 * - MkvSplitter reads the encoder's output (H.264 and AAC in Matroska, as
 *   FFmpeg writes it to a pipe: a segment of unknown size and clusters of
 *   known size) into its header and its clusters, and says which clusters
 *   open with a video keyframe. A recording, or a connection to YouTube made
 *   again, starts from the header and such a cluster.
 */

const ID = {
  EBML: 0x1a45dfa3,
  EBMLVersion: 0x4286,
  EBMLReadVersion: 0x42f7,
  EBMLMaxIDLength: 0x42f2,
  EBMLMaxSizeLength: 0x42f3,
  DocType: 0x4282,
  DocTypeVersion: 0x4287,
  DocTypeReadVersion: 0x4285,
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimestampScale: 0x2ad7b1,
  MuxingApp: 0x4d80,
  WritingApp: 0x5741,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackUID: 0x73c5,
  TrackType: 0x83,
  CodecID: 0x86,
  FlagLacing: 0x9c,
  DefaultDuration: 0x23e383,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  ColourSpace: 0x2eb524,
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
  Channels: 0x9f,
  BitDepth: 0x6264,
  Cluster: 0x1f43b675,
  Timestamp: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  ReferenceBlock: 0xfb,
} as const;

/** An EBML element's size, unknown (a live stream's segment or cluster). */
const UNKNOWN = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

function idBytes(id: number): Buffer {
  const n = id > 0xffffff ? 4 : id > 0xffff ? 3 : id > 0xff ? 2 : 1;
  const b = Buffer.alloc(n);
  b.writeUIntBE(id, 0, n);
  return b;
}

/** An element size as an 8-byte EBML number (always fits, simple to write). */
function sizeBytes(size: number): Buffer {
  const b = Buffer.alloc(8);
  b[0] = 0x01;
  b.writeUIntBE(size, 2, 6);
  return b;
}

function element(id: number, data: Buffer): Buffer {
  return Buffer.concat([idBytes(id), sizeBytes(data.length), data]);
}

function uint(id: number, value: number): Buffer {
  let n = 1;
  while (n < 8 && value >= 2 ** (8 * n)) n++;
  const b = Buffer.alloc(n);
  b.writeUIntBE(value, 0, Math.min(n, 6));
  return element(id, b);
}

function float(id: number, value: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(value, 0);
  return element(id, b);
}

const text = (id: number, value: string) => element(id, Buffer.from(value, 'utf8'));
const master = (id: number, ...children: Buffer[]) => element(id, Buffer.concat(children));

/** Ticks of the writer's clock: 10 microseconds (a block's time is at most ±327 ms from its cluster's). */
export const TIMESTAMP_SCALE_NS = 10_000;
const TICKS_PER_SECOND = 1e9 / TIMESTAMP_SCALE_NS;
/** A new cluster at least this often (well inside the ±327 ms a block can be from its cluster). */
const CLUSTER_SPAN_TICKS = 25_000;

export interface RawVideo {
  width: number;
  height: number;
  /** The frames' layout, as Chromium hands them over (FFmpeg reads each by this name). */
  format: 'I420' | 'NV12' | 'BGRA' | 'RGBA';
  fps: number;
}

export interface RawAudio {
  sampleRate: number;
  channels: number;
}

export const VIDEO_TRACK = 1;
export const AUDIO_TRACK = 2;

/** The encoder's input: raw frames and sound in a live Matroska stream. */
export class MkvWriter {
  private clusterAt: number | null = null;

  constructor(
    private readonly video: RawVideo,
    private readonly audio: RawAudio,
  ) {}

  /** The stream's start: what the file is and its two tracks. */
  header(): Buffer {
    const ebml = master(
      ID.EBML,
      uint(ID.EBMLVersion, 1),
      uint(ID.EBMLReadVersion, 1),
      uint(ID.EBMLMaxIDLength, 4),
      uint(ID.EBMLMaxSizeLength, 8),
      text(ID.DocType, 'matroska'),
      uint(ID.DocTypeVersion, 4),
      uint(ID.DocTypeReadVersion, 2),
    );
    const info = master(
      ID.Info,
      uint(ID.TimestampScale, TIMESTAMP_SCALE_NS),
      text(ID.MuxingApp, 'Drashti'),
      text(ID.WritingApp, 'Drashti'),
    );
    const videoTrack = master(
      ID.TrackEntry,
      uint(ID.TrackNumber, VIDEO_TRACK),
      uint(ID.TrackUID, VIDEO_TRACK),
      uint(ID.TrackType, 1),
      text(ID.CodecID, 'V_UNCOMPRESSED'),
      uint(ID.FlagLacing, 0),
      uint(ID.DefaultDuration, Math.round(1e9 / this.video.fps)),
      master(
        ID.Video,
        uint(ID.PixelWidth, this.video.width),
        uint(ID.PixelHeight, this.video.height),
        element(ID.ColourSpace, Buffer.from(this.video.format, 'ascii')),
      ),
    );
    const audioTrack = master(
      ID.TrackEntry,
      uint(ID.TrackNumber, AUDIO_TRACK),
      uint(ID.TrackUID, AUDIO_TRACK),
      uint(ID.TrackType, 2),
      text(ID.CodecID, 'A_PCM/FLOAT/IEEE'),
      uint(ID.FlagLacing, 0),
      master(
        ID.Audio,
        float(ID.SamplingFrequency, this.audio.sampleRate),
        uint(ID.Channels, this.audio.channels),
        uint(ID.BitDepth, 32),
      ),
    );
    const tracks = master(ID.Tracks, videoTrack, audioTrack);
    return Buffer.concat([ebml, idBytes(ID.Segment), UNKNOWN, info, tracks]);
  }

  /**
   * One block (a frame, or some sound) at `seconds` from the start: a new
   * cluster first when the last one is getting long. Returns the bytes to
   * write, the block's data last (not copied).
   */
  block(track: number, seconds: number, data: Buffer): Buffer[] {
    const ticks = Math.round(seconds * TICKS_PER_SECOND);
    const out: Buffer[] = [];
    if (this.clusterAt === null || ticks - this.clusterAt > CLUSTER_SPAN_TICKS || ticks < this.clusterAt) {
      this.clusterAt = ticks;
      out.push(idBytes(ID.Cluster), UNKNOWN, uint(ID.Timestamp, ticks));
    }
    const head = Buffer.alloc(4);
    head[0] = 0x80 | track;
    head.writeInt16BE(ticks - this.clusterAt, 1);
    // Every raw frame and every bit of sound stands alone: all are keyframes.
    head[3] = 0x80;
    out.push(idBytes(ID.SimpleBlock), sizeBytes(head.length + data.length), head, data);
    return out;
  }
}

// ---- reading what FFmpeg writes ---------------------------------------------------------------

/** An EBML number at `at`: its value, its length, and whether it means "unknown". */
function readVint(b: Buffer, at: number): { value: number; length: number; unknown: boolean } | null {
  if (at >= b.length) return null;
  const first = b[at] ?? 0;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8 || at + length > b.length) return null;
  let value = first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    const byte = b[at + i] ?? 0;
    value = value * 256 + byte;
    if (byte !== 0xff) allOnes = false;
  }
  return { value, length, unknown: allOnes };
}

function readId(b: Buffer, at: number): { id: number; length: number } | null {
  if (at >= b.length) return null;
  const first = b[at] ?? 0;
  let length = 1;
  while (length <= 4 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 4 || at + length > b.length) return null;
  return { id: b.readUIntBE(at, length), length };
}

/** The children of a master element's data: id, where their data starts, and its size. */
function* children(
  b: Buffer,
  start = 0,
  end = b.length,
): Generator<{ id: number; at: number; size: number }> {
  let at = start;
  while (at < end) {
    const id = readId(b, at);
    if (!id) return;
    const size = readVint(b, at + id.length);
    if (!size || size.unknown) return;
    const dataAt = at + id.length + size.length;
    yield { id: id.id, at: dataAt, size: size.value };
    at = dataAt + size.value;
  }
}

/** The video track's number, from the Tracks element's data. */
function videoTrackOf(tracks: Buffer): number | null {
  for (const entry of children(tracks)) {
    if (entry.id !== ID.TrackEntry) continue;
    let number: number | null = null;
    let type: number | null = null;
    for (const c of children(tracks, entry.at, entry.at + entry.size)) {
      if (c.id === ID.TrackNumber) number = tracks.readUIntBE(c.at, Math.min(c.size, 6));
      if (c.id === ID.TrackType) type = tracks.readUIntBE(c.at, Math.min(c.size, 6));
    }
    if (type === 1 && number !== null) return number;
  }
  return null;
}

export interface MkvCluster {
  /** The whole cluster element, as written. */
  bytes: Buffer;
  /** Its time, in the stream's ticks. */
  timestamp: number;
  /** Its first video block is a keyframe: a viewer can start here. */
  startsPicture: boolean;
}

/** What a cluster holds that matters here. */
function readCluster(bytes: Buffer, dataAt: number, videoTrack: number | null): MkvCluster {
  let timestamp = 0;
  let startsPicture = false;
  for (const c of children(bytes, dataAt)) {
    if (c.id === ID.Timestamp) timestamp = bytes.readUIntBE(c.at, Math.min(c.size, 6));
    let block: { at: number; reference: boolean } | null = null;
    if (c.id === ID.SimpleBlock) {
      // The track's number, the time from the cluster's (2 bytes), then the flags: 0x80 for a keyframe.
      const flags = bytes[c.at + (readVint(bytes, c.at)?.length ?? 1) + 2] ?? 0;
      block = { at: c.at, reference: (flags & 0x80) === 0 };
    }
    if (c.id === ID.BlockGroup) {
      let at: number | null = null;
      let reference = false;
      for (const g of children(bytes, c.at, c.at + c.size)) {
        if (g.id === ID.Block) at = g.at;
        if (g.id === ID.ReferenceBlock) reference = true;
      }
      if (at !== null) block = { at, reference };
    }
    if (!block) continue;
    const track = readVint(bytes, block.at)?.value;
    if (videoTrack !== null && track !== videoTrack) continue;
    startsPicture = !block.reference;
    break;
  }
  return { bytes, timestamp, startsPicture };
}

/** The same cluster with its time moved to `timestamp` (so a recording starts at 0), same length. */
export function retimeCluster(cluster: MkvCluster, timestamp: number): Buffer {
  const out = Buffer.from(cluster.bytes);
  const id = readId(out, 0);
  const size = id ? readVint(out, id.length) : null;
  if (!id || !size) return out;
  for (const c of children(out, id.length + size.length)) {
    if (c.id !== ID.Timestamp) continue;
    // Written in the same number of bytes: a smaller time always fits.
    if (timestamp >= 0 && timestamp < 2 ** (8 * Math.min(c.size, 6)))
      out.writeUIntBE(timestamp, c.at, Math.min(c.size, 6));
    break;
  }
  return out;
}

/** Reads FFmpeg's Matroska output as it comes, into its header and its clusters. */
export class MkvSplitter {
  private pending: Buffer = Buffer.alloc(0);
  private headerParts: Buffer[] = [];
  private header: Buffer | null = null;
  private inSegment = false;
  private videoTrack: number | null = null;
  /** Nanoseconds in one tick of the stream's times (FFmpeg writes 1 ms). */
  timestampScaleNs = 1_000_000;

  constructor(
    private readonly onHeader: (header: Buffer) => void,
    private readonly onCluster: (cluster: MkvCluster) => void,
  ) {}

  /** The stream's header, once it has been read (everything before the first cluster). */
  get head(): Buffer | null {
    return this.header;
  }

  push(chunk: Buffer): void {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    for (;;) {
      const id = readId(this.pending, 0);
      if (!id) return;
      const size = readVint(this.pending, id.length);
      if (!size) return;
      const headLength = id.length + size.length;
      if (id.id === ID.Segment && !this.inSegment) {
        // The segment's own header: its children follow at the top level of what is read here.
        this.inSegment = true;
        this.headerParts.push(this.pending.subarray(0, headLength));
        this.pending = this.pending.subarray(headLength);
        continue;
      }
      if (size.unknown) throw new Error('The encoder wrote an element of unknown size where it should not');
      const total = headLength + size.value;
      if (this.pending.length < total) return;
      const bytes = Buffer.from(this.pending.subarray(0, total));
      this.pending = this.pending.subarray(total);
      if (id.id === ID.Cluster) {
        if (!this.header) {
          this.header = Buffer.concat(this.headerParts);
          this.headerParts = [];
          this.onHeader(this.header);
        }
        this.onCluster(readCluster(bytes, headLength, this.videoTrack));
      } else if (!this.header) {
        if (id.id === ID.Tracks) this.videoTrack = videoTrackOf(bytes.subarray(headLength));
        if (id.id === ID.Info)
          for (const c of children(bytes, headLength))
            if (c.id === ID.TimestampScale)
              this.timestampScaleNs = bytes.readUIntBE(c.at, Math.min(c.size, 6));
        this.headerParts.push(bytes);
      }
      // Anything after the clusters (cues, when FFmpeg ends) is not needed.
    }
  }
}
