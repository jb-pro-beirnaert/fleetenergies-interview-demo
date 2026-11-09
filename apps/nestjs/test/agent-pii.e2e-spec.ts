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

/** Every form in which personal data could leak. */
const FORBIDDEN = DRIVERS.flatMap((driver) =>
  [driver.fullName, ...driver.fullName.split(' ')].map(normalize),
);
const FORBIDDEN_PHONES = DRIVERS.map((driver) =>
  digits(driver.phone).slice(-8),
);

describe('No personal data on /agent/*', () => {
  let t: TestApp;
  let alertId: string;
  let invoiceId: string;

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
          body: `${DRIVERS[0].fullName} here, call me back on ${DRIVERS[0].phone} or helene.garnier@durance.fr`,
          dataOrigin: 'history',
        },
        {
          driverId: IDS.otherDriver,
          truckId: IDS.truck,
          sentAt: minutesAfter(126),
          body: `BRUNO says the mechanic Mr Petit (04 75 12 34 56) is draining the tank`,
          dataOrigin: 'history',
        },
      ],
    });
    ({
      alert: { id: alertId },
    } = await startInvestigation(t));
    // A step whose content mentions a driver
    await postStep(t, alertId, {
      attempt: 1,
      seq: 5,
      kind: 'tool_result',
      payload: { note: `Lacombe reachable on ${DRIVERS[1].phone}` },
    }).expect(200);
  });
  afterAll(() => t.app.close());

  function assertNoPii(path: string, body: unknown) {
    const text = JSON.stringify(body);
    const normalized = normalize(text);
    for (const name of FORBIDDEN) {
      expect(normalized, `${path} contains "${name}"`).not.toMatch(
        new RegExp(`(?<![\\p{L}])${name}(?![\\p{L}])`, 'u'),
      );
    }
    for (const phone of FORBIDDEN_PHONES) {
      expect(digits(text), `${path} contains a phone number`).not.toContain(
        phone,
      );
    }
  }

  it('read_driver_messages: pseudonyms and masked text', async () => {
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
        body: 'C-01 here, call me back on [phone masked] or [email masked]',
      },
      {
        sentAt: minutesAfter(126).toISOString(),
        driver: 'C-02',
        body: 'C-02 says the mechanic Mr Petit ([phone masked]) is draining the tank',
      },
    ]);
  });

  // V2: invoice whose text mentions a driver (masked on `/agent/invoices/:id/text`)
  beforeAll(async () => {
    const invoice = await t.prisma.invoice.create({
      data: {
        sha256: 'pii-test',
        filePath: '/nonexistent.pdf',
        rawText: `Invoice F1 – driver ${DRIVERS[0].fullName}, tel. ${DRIVERS[0].phone}, mail helene.garnier@durance.fr – 250.00 L`,
        receivedAt: minutesAfter(150),
        dataOrigin: 'live',
      },
    });
    invoiceId = invoice.id;
  });

  it('walks every GET /agent/* route of the OpenAPI document', async () => {
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
        .replace('/agent/invoices/{id}', `/agent/invoices/${invoiceId}`)
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

  it('the responses of the POST /agent/* routes are safe too', async () => {
    const step = await postStep(t, alertId, {
      attempt: 1,
      seq: 6,
      kind: 'reasoning',
      payload: { text: DRIVERS[0].fullName },
    }).expect(200);
    assertNoPii('steps', step.body);
  });
});
