import type { VerdictCategory } from '@fleet/contracts';
import { decide, statusForDecision } from './decision.js';

const THRESHOLD = 0.75;

describe('decide (decision after the verdict)', () => {
  it.each<VerdictCategory>([
    'theft_suspected',
    'billing_discrepancy',
    'inconclusive',
  ])('%s is always escalated, even with a confidence of 1', (category) => {
    expect(decide(category, 1, THRESHOLD)).toBe('escalated');
    expect(decide(category, 0, THRESHOLD)).toBe('escalated');
  });

  it.each<VerdictCategory>([
    'sensor_fault',
    'equipment_transfer',
    'legitimate_operation',
  ])('%s is closed if confidence ≥ threshold, escalated otherwise', (category) => {
    expect(decide(category, 0.75, THRESHOLD)).toBe('auto_closed');
    expect(decide(category, 0.9, THRESHOLD)).toBe('auto_closed');
    expect(decide(category, 0.74, THRESHOLD)).toBe('escalated');
  });

  it('respects a configured threshold', () => {
    expect(decide('sensor_fault', 0.8, 0.85)).toBe('escalated');
  });

  it('maps the decision to an alert status', () => {
    expect(statusForDecision('auto_closed')).toBe('closed');
    expect(statusForDecision('escalated')).toBe('escalated');
  });
});
