import { describe, expect, it } from 'vitest';
import { StopList, stopTimes } from './lifecycle';

describe('the stop list (Session 23)', () => {
  it('stops services in reverse order of creation, then the last steps in their own order', () => {
    const order: string[] = [];
    const list = new StopList(() => undefined);
    list.addLast('later writes', () => {
      order.push('later writes');
    });
    list.add('outputs', () => {
      order.push('outputs');
    });
    list.add('stream', () => {
      order.push('stream');
    });
    list.addLast('library', () => {
      order.push('library');
    });
    list.add('updates', () => {
      order.push('updates');
    });
    list.addLast('clean-quit mark', () => {
      order.push('clean-quit mark');
    });
    expect(list.run()).toEqual([]);
    expect(order).toEqual(['updates', 'stream', 'outputs', 'later writes', 'library', 'clean-quit mark']);
  });

  it('one failing stop is logged and does not skip the others', () => {
    const order: string[] = [];
    const errors: string[] = [];
    const list = new StopList((name, error) => errors.push(`${name}: ${String(error)}`));
    list.add('network', () => {
      order.push('network');
    });
    list.add('stream', () => {
      throw new Error('The database connection is not open');
    });
    list.add('updates', () => {
      order.push('updates');
    });
    list.addLast('library', () => {
      throw new Error('busy');
    });
    list.addLast('clean-quit mark', () => {
      order.push('clean-quit mark');
    });
    expect(list.run()).toEqual(['stream', 'library']);
    expect(order).toEqual(['updates', 'network', 'clean-quit mark']);
    expect(errors).toEqual(['stream: Error: The database connection is not open', 'library: Error: busy']);
  });

  it('runs once, and logs an asynchronous stop that fails later', async () => {
    let runs = 0;
    const errors: string[] = [];
    const list = new StopList((name) => errors.push(name));
    list.add('network', () => {
      runs++;
      return Promise.reject(new Error('gone'));
    });
    expect(list.done).toBe(false);
    list.run();
    list.run();
    expect(list.done).toBe(true);
    expect(runs).toBe(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toEqual(['network']);
  });

  it('times each stop on its own, in the order they ran: one that fails too, without the logging of its failure (12 Nov 2026)', () => {
    let clock = 1000;
    const errors: string[] = [];
    const list = new StopList(
      (name) => {
        // Logging a failure takes time of its own (a slow disk): never counted as the stop’s.
        clock += 300;
        errors.push(name);
      },
      () => clock,
    );
    list.addLast('library', () => {
      clock += 2104;
    });
    list.add('network', () => {
      clock += 5;
      return Promise.resolve();
    });
    list.add('events out', () => {
      clock += 1;
      throw new Error('gone');
    });
    expect(list.times).toEqual([]);
    expect(list.run()).toEqual(['events out']);
    expect(list.times).toEqual([
      { name: 'events out', ms: 1 },
      { name: 'network', ms: 5 },
      { name: 'library', ms: 2104 },
    ]);
    expect(errors).toEqual(['events out']);
    // Run once: a second run times nothing more.
    list.run();
    expect(list.times).toHaveLength(3);
  });

  it('says each stop’s time as the log does: in the order they ran, in whole ms', () => {
    expect(
      stopTimes([
        { name: 'events out', ms: 0.4 },
        { name: 'updates (an install at quit)', ms: 0 },
        { name: 'library', ms: 2104.5 },
      ]),
    ).toBe('events out 0, updates (an install at quit) 0, library 2105');
    expect(stopTimes([])).toBe('');
  });
});
