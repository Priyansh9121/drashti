import { describe, expect, it } from 'vitest';
import { connectionSeats, PairedSeats } from './paired-seats';

describe('paired device places', () => {
  it('leaves the reserved share for paired devices across many loopback addresses', () => {
    const closed = new Set<number>();
    const seats = new PairedSeats<number>(connectionSeats(256, 32), () => undefined);
    for (let i = 0; i < 256; i++)
      expect(seats.add(i, `127.0.0.${String(1 + (i % 16))}`, () => closed.add(i))).toBe(true);
    expect(closed.size).toBe(192);
    for (let i = 256; i < 448; i++) {
      expect(seats.add(i, `127.0.0.${String(17 + (i % 16))}`, () => closed.add(i))).toBe(true);
      seats.protect(i);
    }
    for (let i = 448; i < 704; i++)
      expect(seats.add(i, `127.0.0.${String(1 + (i % 16))}`, () => closed.add(i))).toBe(true);
    for (let i = 256; i < 448; i++) expect(closed.has(i)).toBe(false);
    seats.clear();
    expect(closed.size).toBe(704);
  });

  it('does not replace a paired device when every place is paired', () => {
    const closed: number[] = [];
    const seats = new PairedSeats<number>(connectionSeats(8, 32), () => undefined);
    for (let i = 0; i < 8; i++) {
      expect(seats.add(i, '127.0.0.1', () => closed.push(i))).toBe(true);
      seats.protect(i);
    }
    expect(seats.add(9, '127.0.0.2', () => closed.push(9))).toBe(false);
    expect(closed).toEqual([]);
  });

  it('releases a response once and accounts for another response on the same connection', () => {
    const closed: number[] = [];
    const seats = new PairedSeats<number>(connectionSeats(4, 32), () => undefined);
    seats.add(1, '127.0.0.1', () => closed.push(1));
    const first = seats.protect(1);
    const second = seats.protect(1);
    first();
    first();
    seats.add(2, '127.0.0.2', () => closed.push(2));
    seats.add(3, '127.0.0.3', () => closed.push(3));
    expect(closed).toEqual([2]);
    second();
    expect(closed).toEqual([2, 1]);
    seats.add(4, '127.0.0.4', () => closed.push(4));
    expect(closed).toEqual([2, 1, 3]);
    seats.remove(3);
    seats.remove(4);
    expect(seats.add(5, '127.0.0.5', () => closed.push(5))).toBe(true);
    expect(seats.openFull(5)).toBe(true);
  });

  it('keeps the address cap even when other addresses have room', () => {
    const seats = new PairedSeats<number>(connectionSeats(256, 2), () => undefined);
    seats.add(1, '127.0.0.1', () => undefined);
    seats.protect(1);
    seats.add(2, '127.0.0.1', () => undefined);
    seats.protect(2);
    expect(seats.add(3, '127.0.0.1', () => undefined)).toBe(false);
    expect(seats.add(4, '127.0.0.2', () => undefined)).toBe(true);
  });
});

it('admits paired feeds up to the address cap by giving waiting feeds their place', () => {
  const closed: number[] = [];
  const seats = new PairedSeats<number>(
    { total: 100, perAddress: 10, open: 20, openPerAddress: 2 },
    () => undefined,
  );
  for (let i = 0; i < 8; i++) {
    expect(seats.add(i, '127.0.0.1', () => closed.push(i))).toBe(true);
    seats.protect(i);
  }
  for (let i = 8; i < 10; i++) expect(seats.add(i, '127.0.0.1', () => closed.push(i))).toBe(true);
  expect(seats.add(10, '127.0.0.1', () => closed.push(10))).toBe(true);
  seats.protect(10);
  expect(seats.add(11, '127.0.0.1', () => closed.push(11))).toBe(true);
  seats.protect(11);
  expect(closed).toEqual([8, 9]);
  expect(seats.add(12, '127.0.0.1', () => closed.push(12))).toBe(false);
  expect(closed).toEqual([8, 9]);
});

it('leaves room for ten devices saying hello together from this computer', () => {
  const closed: number[] = [];
  const seats = new PairedSeats<number>(
    { total: 100, perAddress: 10, open: 20, openPerAddress: 10, replaceWaitingAtAddressLimit: true },
    () => undefined,
  );
  for (let i = 0; i < 10; i++) expect(seats.add(i, '127.0.0.1', () => closed.push(i))).toBe(true);
  expect(closed).toEqual([]);
  expect(seats.add(10, '127.0.0.1', () => closed.push(10))).toBe(true);
  expect(closed).toEqual([0]);
  for (let i = 1; i <= 10; i++) seats.protect(i);
  expect(seats.add(11, '127.0.0.1', () => closed.push(11))).toBe(false);
  expect(closed).toEqual([0]);
});
