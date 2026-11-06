import type { InvestigationStepView } from '@fleet/contracts';
import { buildTrace } from './trace';

let n = 0;
const step = (partial: Partial<InvestigationStepView>): InvestigationStepView => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  attempt: 1,
  seq: 0,
  kind: 'reasoning',
  toolName: null,
  toolCallId: null,
  payload: {},
  durationMs: null,
  createdAt: '2026-10-14T02:00:00Z',
  ...partial,
});

describe('buildTrace', () => {
  it('réunit chaque appel d’outil et son résultat, dans l’ordre des seq', () => {
    const trace = buildTrace([
      step({
        seq: 2,
        kind: 'tool_result',
        toolName: 'get_truck_profile',
        toolCallId: 'E1',
        payload: { result: { plate: 'AB-123-CD' } },
        durationMs: 42,
      }),
      step({ seq: 0, kind: 'reasoning', payload: { text: 'Je commence' } }),
      step({
        seq: 1,
        kind: 'tool_call',
        toolName: 'get_truck_profile',
        toolCallId: 'E1',
        payload: { arguments: { truckId: 'x' } },
      }),
    ]);
    expect(trace).toHaveLength(1);
    const [reasoning, tool] = trace[0]!.items;
    expect(reasoning).toMatchObject({ kind: 'reasoning', text: 'Je commence' });
    expect(tool).toMatchObject({
      kind: 'tool',
      ref: 'E1',
      args: { truckId: 'x' },
      result: { ok: true, value: { plate: 'AB-123-CD' } },
      durationMs: 42,
    });
  });

  it('laisse le résultat indéfini tant que l’outil n’a pas répondu', () => {
    const [attempt] = buildTrace([
      step({
        seq: 0,
        kind: 'tool_call',
        toolName: 'get_tank_curve',
        toolCallId: 'E1',
        payload: { arguments: {} },
      }),
    ]);
    expect(attempt!.items[0]).toMatchObject({ kind: 'tool', result: undefined });
  });

  it('retire l’enveloppe { ref, result } et remonte les erreurs d’outil', () => {
    const [attempt] = buildTrace([
      step({
        seq: 0,
        kind: 'tool_call',
        toolName: 'a',
        toolCallId: 'E1',
        payload: { arguments: {} },
      }),
      step({
        seq: 1,
        kind: 'tool_result',
        toolName: 'a',
        toolCallId: 'E1',
        payload: { result: { ref: 'E1', result: { x: 1 } } },
      }),
      step({
        seq: 2,
        kind: 'tool_call',
        toolName: 'b',
        toolCallId: 'E2',
        payload: { arguments: {} },
      }),
      step({
        seq: 3,
        kind: 'tool_result',
        toolName: 'b',
        toolCallId: 'E2',
        payload: { error: 'fenêtre maximale 72 h' },
      }),
      step({ seq: 4, kind: 'retry', payload: { message: 'Référence inconnue E9' } }),
    ]);
    expect(attempt!.items.map((i) => i.kind)).toEqual(['tool', 'tool', 'retry']);
    expect(attempt!.items[0]).toMatchObject({ result: { ok: true, value: { x: 1 } } });
    expect(attempt!.items[1]).toMatchObject({
      result: { ok: false, error: 'fenêtre maximale 72 h' },
    });
    expect(attempt!.items[2]).toMatchObject({ message: 'Référence inconnue E9' });
  });

  it('sépare les tentatives, où les références E1… repartent de zéro', () => {
    const trace = buildTrace([
      step({
        attempt: 2,
        seq: 0,
        kind: 'tool_call',
        toolName: 'a',
        toolCallId: 'E1',
        payload: { arguments: {} },
      }),
      step({
        attempt: 1,
        seq: 0,
        kind: 'tool_call',
        toolName: 'a',
        toolCallId: 'E1',
        payload: { arguments: {} },
      }),
      step({ attempt: 1, seq: 1, kind: 'error', payload: { message: 'Ollama injoignable' } }),
      step({
        attempt: 2,
        seq: 1,
        kind: 'tool_result',
        toolName: 'a',
        toolCallId: 'E1',
        payload: { result: 1 },
      }),
    ]);
    expect(trace.map((a) => a.attempt)).toEqual([1, 2]);
    expect(trace[0]!.items[0]).toMatchObject({ result: undefined });
    expect(trace[1]!.items[0]).toMatchObject({ result: { ok: true, value: 1 } });
  });
});
