import type { AlertDetail } from '@fleet/contracts';
import { setLang } from './i18n/i18n';
import { decisionReason, invoiceStatusLabel, invoiceStatusTone } from './labels';

const alert = (partial: {
  decision: AlertDetail['decision'];
  category?: NonNullable<AlertDetail['investigation']>['category'];
  details?: Record<string, unknown>;
}) =>
  ({
    decision: partial.decision,
    details: partial.details ?? {},
    investigation: partial.category === undefined ? null : { category: partial.category },
  }) as unknown as AlertDetail;

describe('decisionReason', () => {
  afterEach(() => setLang('en'));

  it('explains that a suspected theft is always escalated', () => {
    expect(decisionReason(alert({ decision: 'escalated', category: 'theft_suspected' }))).toBe(
      '“Suspected theft” is always reviewed by an analyst',
    );
  });

  it('explains an escalation for insufficient confidence', () => {
    expect(decisionReason(alert({ decision: 'escalated', category: 'sensor_fault' }))).toBe(
      'Confidence below the auto-close threshold',
    );
  });

  it('explains an auto-close', () => {
    expect(decisionReason(alert({ decision: 'auto_closed', category: 'sensor_fault' }))).toContain(
      'above the auto-close threshold',
    );
  });

  it('surfaces the investigation failure reason', () => {
    expect(
      decisionReason(alert({ decision: 'escalated', details: { failure: 'no tool called' } })),
    ).toBe('Investigation failed: no tool called');
  });

  it('says nothing until a decision is made', () => {
    expect(decisionReason(alert({ decision: null }))).toBeNull();
  });

  it('follows the current language', () => {
    setLang('fr');
    expect(decisionReason(alert({ decision: 'escalated', category: 'theft_suspected' }))).toBe(
      '« Vol probable » est toujours revu par un analyste',
    );
  });
});

describe('decisionReason (V2)', () => {
  it('a billing discrepancy alert is always escalated', () => {
    const billing = { ...alert({ decision: 'escalated', category: 'sensor_fault' }), type: 'billing_mismatch' } as AlertDetail;
    expect(decisionReason(billing)).toBe('A billing discrepancy is always reviewed by an analyst');
  });
});

describe('invoice statuses (V2)', () => {
  afterEach(() => setLang('en'));

  it('labels follow the language; a discrepancy is red, a match green', () => {
    expect(invoiceStatusLabel('mismatch')).toBe('Discrepancy');
    setLang('fr');
    expect(invoiceStatusLabel('needs_review')).toBe('À vérifier');
    expect(invoiceStatusTone('mismatch')).toBe('bad');
    expect(invoiceStatusTone('matched')).toBe('ok');
    expect(invoiceStatusTone('extracting')).toBe('progress');
  });
});
