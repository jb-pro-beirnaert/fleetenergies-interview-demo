import { loadConfig } from './config.js';

const base = {
  DATABASE_URL: 'postgres://x',
  DEVICE_TOKEN: 'd',
  AGENT_API_TOKEN: 'a',
  ADMIN_TOKEN: 'x',
};

describe('loadConfig', () => {
  it('applique les valeurs par défaut des specs', () => {
    expect(loadConfig(base)).toMatchObject({
      PORT: 3000,
      FUEL_DROP_MIN_L: 40,
      DETECTOR_DEBOUNCE_SECONDS: 15,
      AUTO_CLOSE_MIN_CONFIDENCE: 0.75,
      TASK_SWEEP_INTERVAL_MS: 30_000,
    });
  });

  it('convertit les nombres fournis en texte', () => {
    expect(loadConfig({ ...base, FUEL_DROP_MIN_L: '55' }).FUEL_DROP_MIN_L).toBe(
      55,
    );
  });

  it('refuse de démarrer sans jeton', () => {
    expect(() => loadConfig({ ...base, ADMIN_TOKEN: undefined })).toThrow(
      /ADMIN_TOKEN/,
    );
  });
});
