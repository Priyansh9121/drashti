import { describe, expect, it } from 'vitest';
import { AUDIO_TRACK, MkvSplitter, MkvWriter, VIDEO_TRACK, type MkvCluster } from './mkv';
import { consumerTake, newConsumer } from './pipeline';

// Three hours of 30-fps timestamps, driven without real-time waiting. Native encoder/part rollover is
// separately exercised by pipeline.test.ts. This checks the packet timeline and late listener's zero point.
describe('H6 long show timeline', () => {
  it('keeps three hours of picture and sound time, and a late listener joins at zero without losing a cluster', () => {
    const writer = new MkvWriter(
      { width: 16, height: 16, format: 'I420', fps: 30 },
      { sampleRate: 48000, channels: 2 },
    );
    const header = writer.header();
    const picture = Buffer.alloc((16 * 16 * 3) / 2, 96);
    const sound = Buffer.alloc(8);
    const recording = newConsumer();
    const lateListener = newConsumer();
    let count = 0;
    let previous = -1;
    let last = -1;
    let joinedAt = -1;
    let given = 0;
    let headers = 0;
    let lateFirst = -1;
    let lateLast = -1;
    const readTime = (bytes: Buffer) => {
      const clusters: MkvCluster[] = [];
      const reader = new MkvSplitter(
        () => undefined,
        (c) => clusters.push(c),
      );
      reader.push(Buffer.concat([header, bytes]));
      const ticks = clusters[0]?.timestamp;
      return ticks === undefined ? -1 : ticks * reader.timestampScaleNs;
    };
    const splitter = new MkvSplitter(
      () => undefined,
      (cluster) => {
        // Keep integer nanoseconds for exact differences; convert to milliseconds only for the end checks.
        const nanoseconds = cluster.timestamp * splitter.timestampScaleNs;
        expect(nanoseconds).toBeGreaterThan(previous);
        previous = nanoseconds;
        last = nanoseconds;
        count++;
        const out = consumerTake(recording, cluster, header);
        if (!out) throw new Error('The recording lost a cluster');
        given++;
        headers += out.filter((b) => b.equals(header)).length;
        if (nanoseconds >= 2 * 60 * 60 * 1e9) {
          if (joinedAt < 0) joinedAt = nanoseconds;
          const late = consumerTake(lateListener, cluster, header);
          if (!late) throw new Error('The late listener lost a cluster');
          const time = readTime(late[late.length - 1] ?? Buffer.alloc(0));
          if (lateFirst < 0) lateFirst = time;
          lateLast = time;
          expect(time).toBe(nanoseconds - joinedAt);
        }
      },
    );
    splitter.push(header);
    // MkvWriter makes live encoder INPUT with unknown-sized clusters. The encoder's OUTPUT has known
    // sizes (the contract MkvSplitter reads). Packetize the generated timeline as that output does.
    let pending: Buffer[] = [];
    const flush = () => {
      if (pending.length === 0) return;
      const cluster = Buffer.concat(pending);
      cluster.fill(0, 4, 12);
      cluster[4] = 1;
      cluster.writeUIntBE(cluster.length - 12, 6, 6);
      splitter.push(cluster);
      pending = [];
    };
    const add = (parts: Buffer[]) => {
      if (parts[0]?.equals(Buffer.from([0x1f, 0x43, 0xb6, 0x75]))) flush();
      pending.push(...parts);
    };
    const end = 3 * 60 * 60 * 30;
    for (let frame = 0; frame <= end; frame++) {
      const seconds = frame / 30;
      add(writer.block(VIDEO_TRACK, seconds, picture));
      add(writer.block(AUDIO_TRACK, seconds, sound));
    }
    flush();
    console.log(
      `HUNT-x71 long-show frames=${String(end + 1)} clusters=${String(count)} lastMs=${String(last / 1e6)} lateJoinMs=${String(joinedAt / 1e6)} lateLastMs=${String(lateLast / 1e6)}`,
    );
    expect(last / 1e6).toBe(3 * 60 * 60 * 1000);
    expect(given).toBe(count);
    expect(headers).toBe(1);
    expect(lateFirst).toBe(0);
    expect(lateLast).toBe(last - joinedAt);
    expect(lateLast / 1e6).toBeGreaterThanOrEqual(60 * 60 * 1000 - 250);
  });
});
