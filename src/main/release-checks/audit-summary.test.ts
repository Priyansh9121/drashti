import { describe, expect, it } from 'vitest';
import { auditSummary } from '../../../scripts/audit-summary.mjs';

/* The advisory dependency audit's summary (Session 30 step 6), from canned reports. */

describe('the dependency audit, summed up', () => {
  it('says when nothing is known', () => {
    const none = JSON.stringify({ advisories: {}, metadata: { vulnerabilities: { low: 0, high: 0 } } });
    expect(auditSummary(none)).toEqual(['Dependency audit (advisory): no known vulnerabilities.']);
  });

  it('counts by severity, and names the high and critical ones', () => {
    const report = JSON.stringify({
      advisories: {
        1: {
          module_name: 'placeholder-lib',
          severity: 'high',
          title: 'A placeholder advisory',
          url: 'https://example.com/a',
          findings: [{ version: '1.2.3' }],
        },
        2: { module_name: 'another-lib', severity: 'low', title: 'Minor', findings: [{ version: '0.1.0' }] },
        3: {
          module_name: 'worst-lib',
          severity: 'critical',
          title: 'A worse one',
          findings: [{ version: '2.0.0' }],
        },
      },
      metadata: { vulnerabilities: { info: 0, low: 1, moderate: 0, high: 1, critical: 1 } },
    });
    expect(auditSummary(report)).toEqual([
      'Dependency audit (advisory): 1 critical, 1 high, 1 low.',
      '  critical: worst-lib 2.0.0: A worse one',
      '  high: placeholder-lib 1.2.3: A placeholder advisory (https://example.com/a)',
    ]);
  });

  it('a report it cannot read is said, never thrown', () => {
    expect(auditSummary('not json')).toEqual(['Dependency audit (advisory): its report could not be read.']);
  });
});
