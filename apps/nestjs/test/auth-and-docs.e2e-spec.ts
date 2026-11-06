import { auth, createTestApp, type TestApp } from './support/app.js';

describe('Authentication and documentation', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());

  it.each([
    ['post', '/api/telemetry', 'device'],
    ['post', '/agent/tasks/claim', 'agent'],
    ['get', '/agent/alerts/00000000-0000-4000-8000-000000000001', 'agent'],
    ['post', '/admin/wipe', 'admin'],
  ] as const)(
    '%s %s: 401 without a token or with a wrong token, 403 with another role',
    async (method, path, role) => {
      await t.http()[method](path).expect(401);
      await t
        .http()
        [method](path)
        .set('Authorization', 'Bearer faux')
        .expect(401);
      const other = role === 'admin' ? 'device' : 'admin';
      await t.http()[method](path).set(auth(other)).expect(403);
    },
  );

  it('/docs serves Swagger UI and the OpenAPI document', async () => {
    const ui = await t.http().get('/docs').expect(200);
    expect(ui.text).toContain('swagger-ui');

    const doc = (await t.http().get('/docs/json').expect(200)).body;
    expect(doc.info.title).toBe('Fleet Copilot API');
    expect(Object.keys(doc.components.securitySchemes)).toEqual([
      'device',
      'agent',
      'admin',
    ]);
    expect(
      doc.paths['/api/telemetry'].post.requestBody.content['application/json']
        .schema,
    ).toEqual({
      $ref: '#/components/schemas/TelemetryBatch',
    });
    expect(doc.paths['/agent/tasks/claim'].post.security).toEqual([
      { agent: [] },
    ]);
    expect(doc.components.schemas.Verdict.properties.category.enum).toContain(
      'theft_suspected',
    );

    await t.http().get('/docs/yaml').expect(200);
  });
});
