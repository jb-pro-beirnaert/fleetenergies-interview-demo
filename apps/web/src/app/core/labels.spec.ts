import type { AlertDetail } from '@fleet/contracts';
import { decisionReason } from './labels';

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
  it('explique qu’un vol probable est toujours escaladé', () => {
    expect(decisionReason(alert({ decision: 'escalated', category: 'theft_suspected' }))).toContain(
      'toujours revu',
    );
  });

  it('explique une escalade pour confiance insuffisante', () => {
    expect(decisionReason(alert({ decision: 'escalated', category: 'sensor_fault' }))).toBe(
      'Confiance sous le seuil d’auto-clôture',
    );
  });

  it('explique une auto-clôture', () => {
    expect(decisionReason(alert({ decision: 'auto_closed', category: 'sensor_fault' }))).toContain(
      'au-dessus du seuil',
    );
  });

  it('remonte le motif d’échec d’enquête', () => {
    expect(
      decisionReason(alert({ decision: 'escalated', details: { failure: 'aucun outil appelé' } })),
    ).toBe('Enquête en échec : aucun outil appelé');
  });

  it('ne dit rien tant qu’aucune décision n’est prise', () => {
    expect(decisionReason(alert({ decision: null }))).toBeNull();
  });
});
