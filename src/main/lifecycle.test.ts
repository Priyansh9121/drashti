import { describe, expect, it } from 'vitest';
import { StopList } from './lifecycle';

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
    list.add('roles', () => {
      order.push('roles');
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
    expect(order).toEqual(['updates', 'roles', 'clean-quit mark']);
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
});
