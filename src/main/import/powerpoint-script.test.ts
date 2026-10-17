import { describe, expect, it } from 'vitest';
import { POWERPOINT_WINDOWS_SCRIPT } from './deck-converters';

/*
 * PowerPoint on Windows opens a deck with its macros off (Sessions 31–36, SEC-13): its automation security
 * forced to 3 (msoAutomationSecurityForceDisable) before Presentations.Open, and put back as it was in the
 * script's finally, whatever happened.
 */

describe('the PowerPoint script', () => {
  const script = POWERPOINT_WINDOWS_SCRIPT;
  const at = (text: string) => script.indexOf(text);

  it('forces macros off before it opens the deck', () => {
    expect(at('$security = $app.AutomationSecurity')).toBeGreaterThan(-1);
    expect(at('$app.AutomationSecurity = 3')).toBeGreaterThan(at('$security = $app.AutomationSecurity'));
    expect(at('$app.AutomationSecurity = 3')).toBeLessThan(at('$app.Presentations.Open('));
    // Never set inside a try that would carry on without it.
    expect(script).not.toMatch(/try \{ \$app\.AutomationSecurity = 3 \} catch/u);
  });

  it('puts the setting back as it was, in finally', () => {
    const finallyAt = at('} finally {');
    expect(finallyAt).toBeGreaterThan(at('$app.Presentations.Open('));
    expect(script.slice(finallyAt)).toContain('$app.AutomationSecurity = $security');
  });
});
