import { describe, expect, it } from 'vitest';
import { MAX_EVIDENCE } from '@fleet/contracts';
import { checkVerdict, collectFacts, emptyFacts, type InvestigationFacts } from './verdict-tool.js';

const refs = new Set(Array.from({ length: 10 }, (_, i) => `E${i + 1}`));
const verdict = (count: number) => ({
  category: 'sensor_fault',
  confidence: 0.9,
  summary: 'The level dropped then recovered without any refuel: the gauge is wrong.',
  evidence: Array.from({ length: count }, (_, i) => ({ toolCallId: `E${i + 1}`, finding: `Finding ${i + 1}` })),
});

describe('checkVerdict', () => {
  it(`accepts up to ${MAX_EVIDENCE} evidence items`, () => {
    expect(checkVerdict(verdict(MAX_EVIDENCE), refs).ok).toBe(true);
  });

  it('explains how to fix a verdict with too many evidence items', () => {
    const check = checkVerdict(verdict(MAX_EVIDENCE + 1), refs);
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.message).toBe(
      `Invalid verdict: ${MAX_EVIDENCE + 1} evidence items, at most ${MAX_EVIDENCE} are allowed. ` +
        'Keep only the most decisive ones (one per tool result). Call submit_verdict again.',
    );
  });
});

describe('verdict guardrails (facts computed by the API)', () => {
  const facts = (...results: [string, unknown][]): InvestigationFacts => {
    const f = emptyFacts();
    for (const [tool, result] of results) collectFacts(f, tool, result);
    return f;
  };
  const as = (category: string) => ({ ...verdict(2), category });
  const flatCurve = ['get_tank_curve', { recoveries: [] }] as [string, unknown];
  const plainTruck = ['get_truck_profile', { sensorNotes: null, hasReefer: false }] as [string, unknown];

  it('rejects sensor_fault when the level never recovered and there are no sensor notes', () => {
    const check = checkVerdict(as('sensor_fault'), refs, 'fuel_drop', facts(flatCurve, plainTruck));
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.message).toMatch(/no recovery.*A drop that stays low is not a sensor fault/);
  });

  it('accepts sensor_fault with a recovery or with sensor notes', () => {
    const recovered = facts(['get_tank_curve', { recoveries: [{ at: '2026-11-17T06:15:00Z', liters: 88 }] }], plainTruck);
    const notes = facts(flatCurve, ['get_truck_profile', { sensorNotes: 'Sensor replaced', hasReefer: false }]);
    expect(checkVerdict(as('sensor_fault'), refs, 'fuel_drop', recovered).ok).toBe(true);
    expect(checkVerdict(as('sensor_fault'), refs, 'fuel_drop', notes).ok).toBe(true);
  });

  it('rejects equipment_transfer on a truck without a reefer unit', () => {
    expect(checkVerdict(as('equipment_transfer'), refs, 'fuel_drop', facts(plainTruck)).ok).toBe(false);
    const reefer = facts(['get_truck_profile', { sensorNotes: null, hasReefer: true }]);
    expect(checkVerdict(as('equipment_transfer'), refs, 'fuel_drop', reefer).ok).toBe(true);
  });

  it('rejects legitimate_operation without any driver message', () => {
    expect(checkVerdict(as('legitimate_operation'), refs, 'fuel_drop', facts(['read_driver_messages', { messages: [] }])).ok).toBe(false);
    const withMessage = facts(['read_driver_messages', { messages: [{ text: 'Draining the tank at the workshop' }] }]);
    expect(checkVerdict(as('legitimate_operation'), refs, 'fuel_drop', withMessage).ok).toBe(true);
  });

  it('does not judge what the tools did not show, nor billing alerts', () => {
    expect(checkVerdict(as('sensor_fault'), refs, 'fuel_drop', emptyFacts()).ok).toBe(true);
    expect(checkVerdict(as('sensor_fault'), refs, 'billing_mismatch', facts(flatCurve, plainTruck)).ok).toBe(true);
  });
});
