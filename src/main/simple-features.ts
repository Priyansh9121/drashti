import type { SimpleFeature, SimpleFeatureResult } from '../shared/simple-features';
import { chooseSimpleFeature, readSimpleFeatures, simpleFeatureName } from '../shared/simple-features';

/*
 * Simple Mode Features (alpha.22, shared/simple-features.ts): which of Pro Mode's tools Simple Mode has, kept with this
 * computer's library as the mode is (Simple Mode is this computer's), read back as Drashti starts, and told to the
 * window as it changes. Only Pro Mode changes it: Simple Mode's lock refuses the change (main/simple-mode.ts).
 */
export class SimpleFeaturesKeeper {
  private now: readonly SimpleFeature[];

  constructor(
    private readonly deps: {
      /** What was kept, as the library has it (undefined: nothing yet). */
      saved: unknown;
      save: (chosen: readonly SimpleFeature[]) => void;
      /** Told after each change: the window shows or takes away the sections, the lock follows at once. */
      changed: (chosen: readonly SimpleFeature[]) => void;
      log: (line: string) => void;
    },
  ) {
    this.now = readSimpleFeatures(deps.saved);
  }

  /** The tools Simple Mode has now, in the column's order. */
  chosen(): readonly SimpleFeature[] {
    return this.now;
  }

  /** One tool on or off (a fourth refused, saying why); kept and told only when it changes. */
  set(feature: unknown, on: unknown): SimpleFeatureResult {
    const result = chooseSimpleFeature(this.now, feature, on);
    if (!result.ok) return result;
    if (result.chosen.join() === this.now.join()) return result;
    this.now = result.chosen;
    this.deps.save(result.chosen);
    const names = result.chosen.map(simpleFeatureName).join(', ');
    this.deps.log(
      `Simple Mode Features: ${simpleFeatureName(feature as SimpleFeature)} ${on === true ? 'on' : 'off'} (now ${names === '' ? 'none' : names})`,
    );
    this.deps.changed(result.chosen);
    return result;
  }
}
