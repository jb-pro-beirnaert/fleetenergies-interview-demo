import type { VerdictCategory } from '@fleet/contracts';
import { decide, statusForDecision } from './decision.js';

const THRESHOLD = 0.75;

describe('decide (décision après verdict)', () => {
  it.each<VerdictCategory>([
    'theft_suspected',
    'billing_discrepancy',
    'inconclusive',
  ])('%s est toujours escaladé, même avec une confiance de 1', (category) => {
    expect(decide(category, 1, THRESHOLD)).toBe('escalated');
    expect(decide(category, 0, THRESHOLD)).toBe('escalated');
  });

  it.each<VerdictCategory>([
    'sensor_fault',
    'equipment_transfer',
    'legitimate_operation',
  ])('%s est clos si confiance ≥ seuil, escaladé sinon', (category) => {
    expect(decide(category, 0.75, THRESHOLD)).toBe('auto_closed');
    expect(decide(category, 0.9, THRESHOLD)).toBe('auto_closed');
    expect(decide(category, 0.74, THRESHOLD)).toBe('escalated');
  });

  it('respecte un seuil configuré', () => {
    expect(decide('sensor_fault', 0.8, 0.85)).toBe('escalated');
  });

  it('traduit la décision en statut d’alerte', () => {
    expect(statusForDecision('auto_closed')).toBe('closed');
    expect(statusForDecision('escalated')).toBe('escalated');
  });
});
