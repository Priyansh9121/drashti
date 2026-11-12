import { expect, it } from 'vitest';
import { REST } from '../../../shared/lower-third-animations';
import { paintLowerThirdPose } from './lower-third-paint';

function drawing() {
  const writes: string[] = [];
  const style = new Proxy(
    { opacity: '', transform: '', clipPath: '', transformOrigin: '', filter: '' },
    {
      set(target, key, value: string) {
        writes.push(String(key));
        return Reflect.set(target, key, value);
      },
    },
  );
  return { writes, style };
}

it('keeps identical poses from writing CSS on every frame', () => {
  const { style, writes } = drawing();
  const frame = { ...REST, opacity: 0.5, transform: 'scale(0.8)' };
  paintLowerThirdPose(style, frame);
  expect(writes).toEqual(['opacity', 'transform']);
  writes.length = 0;
  paintLowerThirdPose(style, { ...frame });
  expect(writes).toEqual([]);
  paintLowerThirdPose(style, { ...frame, opacity: 0.8 });
  expect(writes).toEqual(['opacity']);
});

it('only attaches a blur and transform while the unit is visible', () => {
  const { style } = drawing();
  const motion = { ...REST, transform: 'translateX(20%)', filter: 'blur(0.2em)' };
  paintLowerThirdPose(style, { ...motion, opacity: 0 });
  expect(style).toMatchObject({ opacity: '0', transform: '', filter: '' });
  paintLowerThirdPose(style, { ...motion, opacity: 0.1 });
  expect(style).toMatchObject({ opacity: '0.1', transform: motion.transform, filter: motion.filter });
  paintLowerThirdPose(style, { ...motion, opacity: 0 });
  expect(style).toMatchObject({ opacity: '0', transform: '', filter: '' });
});
