import { expect, it } from 'vitest';
import { MIGRATIONS } from './migrate';

it('lists migrations in version order', () => {
  const versions = MIGRATIONS.map(({ version }) => version);
  expect(versions).toEqual([...versions].sort((a, b) => a - b));
});
