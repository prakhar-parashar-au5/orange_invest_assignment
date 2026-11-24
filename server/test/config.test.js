import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('defaults to the local Docker dev DB outside test and production', () => {
    const config = loadConfig({});

    expect(config.port).toBe(4101);
    expect(config.clientOrigin).toBe('http://localhost:5181');
    expect(config.databaseUrl).toBe('mysql://orange_app:orange_app_dev@127.0.0.1:3306/orange_invest_dev');
    expect(config.readonlyDatabaseUrl).toBe(
      'mysql://orange_agent_ro:orange_agent_ro_dev@127.0.0.1:3306/orange_invest_dev',
    );
    expect(config.jwtSecret).toBeTruthy();
    expect(config.cookieSecure).toBe(false);
  });

  it('points both default pools at orange_invest_test when NODE_ENV=test', () => {
    const config = loadConfig({ NODE_ENV: 'test' });

    expect(config.databaseUrl).toMatch(/\/orange_invest_test$/);
    expect(config.readonlyDatabaseUrl).toMatch(/\/orange_invest_test$/);
  });

  it('uses env values when given', () => {
    const config = loadConfig({
      PORT: '4100',
      CLIENT_ORIGIN: 'http://localhost:5180',
      DATABASE_URL: 'mysql://a:b@h:1/x',
      DATABASE_READONLY_URL: 'mysql://c:d@h:1/x',
      JWT_SECRET: 's',
      OPENAI_MODEL: 'some-model',
    });

    expect(config.port).toBe(4100);
    expect(config.clientOrigin).toBe('http://localhost:5180');
    expect(config.databaseUrl).toBe('mysql://a:b@h:1/x');
    expect(config.readonlyDatabaseUrl).toBe('mysql://c:d@h:1/x');
    expect(config.jwtSecret).toBe('s');
    expect(config.openaiModel).toBe('some-model');
  });

  it('throws in production when a required secret is missing, naming every missing one', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(
      /DATABASE_URL.*DATABASE_READONLY_URL.*JWT_SECRET.*OPENAI_API_KEY/,
    );
  });

  it('starts in production when everything is set, with Secure cookies', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'mysql://a:b@h:1/x',
      DATABASE_READONLY_URL: 'mysql://c:d@h:1/x',
      JWT_SECRET: 's',
      OPENAI_API_KEY: 'k',
    });

    expect(config.cookieSecure).toBe(true);
    expect(config.clientOrigin).toBeNull();
  });
});
