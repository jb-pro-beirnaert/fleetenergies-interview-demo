import type { Verdict } from '@fleet/contracts';
import { auth, type TestApp } from './app.js';
import { createAlertWithTask } from './fixtures.js';

export const verdict = (overrides: Partial<Verdict> = {}): Verdict => ({
  category: 'sensor_fault',
  confidence: 0.9,
  summary:
    'La baisse est suivie d’une remontée de 88 L sans plein : artefact de sonde déjà signalé.',
  evidence: [
    {
      toolCallId: 'E1',
      finding: 'Remontée de 88 L dix minutes après la chute',
    },
  ],
  ...overrides,
});

/** Alerte réservée par `worker-a`, avec des étapes `tool_call` E1 et E2 (tentative 1). */
export async function startInvestigation(t: TestApp) {
  const { alert, task } = await createAlertWithTask(t.prisma);
  await t
    .http()
    .post('/agent/tasks/claim')
    .set(auth('agent'))
    .send({ type: 'investigate_alert', workerId: 'worker-a' })
    .expect(200);
  for (const [seq, ref] of [
    [0, 'E1'],
    [2, 'E2'],
  ] as const) {
    await postStep(t, alert.id, {
      attempt: 1,
      seq,
      kind: 'tool_call',
      toolName: 'get_tank_curve',
      toolCallId: ref,
      payload: { arguments: {} },
    }).expect(200);
  }
  return { alert, task };
}

export const postStep = (t: TestApp, alertId: string, step: object) =>
  t
    .http()
    .post(`/agent/investigations/${alertId}/steps`)
    .set(auth('agent'))
    .send(step);

export const postVerdict = (t: TestApp, alertId: string, v: Verdict) =>
  t
    .http()
    .post(`/agent/investigations/${alertId}/verdict`)
    .set(auth('agent'))
    .send({
      verdict: v,
      model: 'fleet-qwen',
      promptVersion: 'investigator-v1',
      toolCallsCount: 2,
    });
