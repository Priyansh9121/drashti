import { describe, expect, it } from 'vitest';
import { frameBytes, type RawFrame } from './frames';
import { type StandInSeen, StandInSender, WRITE_MS } from './stand-in';

/*
 * The tests' stand-in receiver (x30): what it writes for the end-to-end test to read. Generated frames only.
 */

function rgba(width: number, height: number, rgb: [number, number, number]): RawFrame {
  const data = new Uint8Array(frameBytes('RGBA', width, height));
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
  return { format: 'RGBA', width, height, data };
}

function rig() {
  let now = 5000;
  const writes: StandInSeen[] = [];
  const timers: { run: () => void; due: number }[] = [];
  const sender = new StandInSender(
    'seen.json',
    'Hall',
    {
      now: () => now,
      later: (run, ms) => {
        timers.push({ run, due: now + ms });
      },
    },
    (file, text) => {
      expect(file).toBe('seen.json');
      writes.push(JSON.parse(text) as StandInSeen);
    },
  );
  const pass = (ms: number) => {
    now += ms;
    const due = timers.filter((t) => t.due <= now);
    for (const t of due) timers.splice(timers.indexOf(t), 1);
    for (const t of due) t.run();
  };
  return { sender, writes, pass };
}

describe('the stand-in receiver (x30)', () => {
  it('writes the first frame at once: its count, size, format, middle colour, name and time', () => {
    const r = rig();
    expect(r.sender.frame(rgba(8, 4, [200, 30, 30]))).toBe(true);
    expect(r.writes).toEqual([
      { name: 'Hall', frames: 1, width: 8, height: 4, format: 'RGBA', middle: [200, 30, 30], at: 5000 },
    ]);
  });

  it('writes at most every WRITE_MS, and always the newest frame in the end', () => {
    const r = rig();
    r.sender.frame(rgba(8, 4, [200, 30, 30]));
    r.pass(10);
    r.sender.frame(rgba(8, 4, [30, 30, 200]));
    r.pass(10);
    r.sender.frame(rgba(8, 4, [30, 200, 30]));
    expect(r.writes).toHaveLength(1);
    // Its time comes: the newest of those that came meanwhile is written.
    r.pass(WRITE_MS);
    expect(r.writes).toHaveLength(2);
    expect(r.writes[1]).toMatchObject({ frames: 3, middle: [30, 200, 30] });
    // Long after: the next frame is written at once.
    r.pass(WRITE_MS * 5);
    r.sender.frame(rgba(8, 4, [10, 10, 10]));
    expect(r.writes.at(-1)).toMatchObject({ frames: 4, middle: [10, 10, 10] });
  });

  it('writes nothing more once stopped', () => {
    const r = rig();
    r.sender.frame(rgba(8, 4, [200, 30, 30]));
    r.sender.frame(rgba(8, 4, [30, 30, 200]));
    r.sender.stop();
    r.pass(WRITE_MS * 2);
    expect(r.sender.frame(rgba(8, 4, [30, 200, 30]))).toBe(false);
    expect(r.writes).toHaveLength(1);
  });
});
