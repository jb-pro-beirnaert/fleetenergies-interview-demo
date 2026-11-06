import { stripAccents } from '../src/pii/pii.js';
import {
  auth,
  createTestApp,
  resetDatabase,
  type TestApp,
} from './support/app.js';
import {
  DRIVERS,
  IDS,
  minutesAfter,
  readings,
  seedReference,
} from './support/fixtures.js';
import { postStep, startInvestigation } from './support/investigation.js';

const normalize = (text: string) => stripAccents(text).toLowerCase();
const digits = (text: string) => text.replace(/\D/g, '');

/** Toutes les formes sous lesquelles une donnée personnelle pourrait fuiter. */
const FORBIDDEN = DRIVERS.flatMap((driver) =>
  [driver.fullName, ...driver.fullName.split(' ')].map(normalize),
);
const FORBIDDEN_PHONES = DRIVERS.map((driver) =>
  digits(driver.phone).slice(-8),
);

describe('Aucune donnée personnelle sur /agent/*', () => {
  let t: TestApp;
  let alertId: string;

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(t.prisma);
    await seedReference(t.prisma);
    await t
      .http()
      .post('/api/telemetry')
      .set(auth('device'))
      .send({
        readings: readings([
          { minute: 120, level: 500 },
          { minute: 125, level: 460 },
          { minute: 130, level: 380 },
        ]),
        source: 'history',
      })
      .expect(202);
    await t.prisma.driverMessage.createMany({
      data: [
        {
          driverId: IDS.driver,
          truckId: IDS.truck,
          sentAt: minutesAfter(121),
          body: `Ici ${DRIVERS[0].fullName}, rappelez-moi au ${DRIVERS[0].phone} ou helene.garnier@durance.fr`,
          dataOrigin: 'history',
        },
        {
          driverId: IDS.otherDriver,
          truckId: IDS.truck,
          sentAt: minutesAfter(126),
          body: `BRUNO dit que le mécanicien M. Petit (04 75 12 34 56) vidange le réservoir`,
          dataOrigin: 'history',
        },
      ],
    });
    ({
      alert: { id: alertId },
    } = await startInvestigation(t));
    // Une étape dont le contenu mentionne un conducteur
    await postStep(t, alertId, {
      attempt: 1,
      seq: 5,
      kind: 'tool_result',
      payload: { note: `Lacombe joignable au ${DRIVERS[1].phone}` },
    }).expect(200);
  });
  afterAll(() => t.app.close());

  function assertNoPii(path: string, body: unknown) {
    const text = JSON.stringify(body);
    const normalized = normalize(text);
    for (const name of FORBIDDEN) {
      expect(normalized, `${path} contient « ${name} »`).not.toMatch(
        new RegExp(`(?<![\\p{L}])${name}(?![\\p{L}])`, 'u'),
      );
    }
    for (const phone of FORBIDDEN_PHONES) {
      expect(digits(text), `${path} contient un téléphone`).not.toContain(
        phone,
      );
    }
  }

  it('read_driver_messages : pseudonymes et textes masqués', async () => {
    const response = await t
      .http()
      .get(`/agent/trucks/${IDS.truck}/driver-messages`)
      .query({
        from: minutesAfter(0).toISOString(),
        to: minutesAfter(200).toISOString(),
      })
      .set(auth('agent'))
      .expect(200);
    expect(response.body.messages).toEqual([
      {
        sentAt: minutesAfter(121).toISOString(),
        driver: 'C-01',
        body: 'Ici C-01, rappelez-moi au [téléphone masqué] ou [e-mail masqué]',
      },
      {
        sentAt: minutesAfter(126).toISOString(),
        driver: 'C-02',
        body: 'C-02 dit que le mécanicien M. Petit ([téléphone masqué]) vidange le réservoir',
      },
    ]);
  });

  it('parcourt toutes les routes GET /agent/* de la documentation OpenAPI', async () => {
    const doc = (await t.http().get('/docs/json').expect(200)).body as {
      paths: Record<string, Record<string, unknown>>;
    };
    const agentGets = Object.entries(doc.paths)
      .filter(
        ([path, operations]) =>
          path.startsWith('/agent/') && 'get' in operations,
      )
      .map(([path]) => path);
    expect(agentGets.length).toBeGreaterThanOrEqual(8);

    for (const template of agentGets) {
      const path = template
        .replace('{truckId}', IDS.truck)
        .replace('{id}', alertId)
        .replace('{alertId}', alertId);
      const response = await t
        .http()
        .get(path)
        .query({
          from: minutesAfter(0).toISOString(),
          to: minutesAfter(200).toISOString(),
          lookbackDays: 30,
        })
        .set(auth('agent'));
      expect(response.status, path).toBe(200);
      assertNoPii(path, response.body);
    }
  });

  it('les réponses des routes POST /agent/* sont également sûres', async () => {
    const step = await postStep(t, alertId, {
      attempt: 1,
      seq: 6,
      kind: 'reasoning',
      payload: { text: DRIVERS[0].fullName },
    }).expect(200);
    assertNoPii('steps', step.body);
  });
});
