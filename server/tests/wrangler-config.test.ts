import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type ParsedEnv = {
  base: Record<string, string>;
  vars: Record<string, string>;
};

const parseTomlString = (value: string | undefined) => {
  if (typeof value === 'undefined') return undefined;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const parseTomlArray = (value: string | undefined) => {
  if (typeof value === 'undefined') return [];
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return [];
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(',')
    .map((item) => parseTomlString(item))
    .filter((item): item is string => Boolean(item));
};

const loadWranglerEnvironments = () => {
  const wranglerPath = resolve(__dirname, '..', 'wrangler.toml');
  const contents = readFileSync(wranglerPath, 'utf8');
  const lines = contents.split(/\r?\n/);

  const envs = new Map<string, ParsedEnv>();
  let currentEnv: string | null = null;
  let currentScope: 'base' | 'vars' | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const sectionMatch = line.match(/^\[(.+?)\]$/);
    if (sectionMatch) {
      const section = sectionMatch[1];
      const envMatch = section.match(/^env\.([^.]+)(?:\.(.+))?$/);
      if (!envMatch) {
        currentEnv = null;
        currentScope = null;
        continue;
      }

      const envName = envMatch[1];
      const subSection = envMatch[2];
      if (!envs.has(envName)) {
        envs.set(envName, { base: {}, vars: {} });
      }

      currentEnv = envName;
      currentScope = subSection === undefined ? 'base' : subSection === 'vars' ? 'vars' : null;
      continue;
    }

    if (!currentEnv || !currentScope) continue;
    const kvMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!kvMatch) continue;

    const [, key, rawValue] = kvMatch;
    const envConfig = envs.get(currentEnv)!;
    envConfig[currentScope][key] = rawValue.trim();
  }

  return envs;
};

describe('wrangler.toml environments', () => {
  const envs = loadWranglerEnvironments();

  it('defines local, dev, and prod environments', () => {
    expect(envs.has('local')).toBe(true);
    expect(envs.has('dev')).toBe(true);
    expect(envs.has('prod')).toBe(true);
  });

  it('sets environment name and ENVIRONMENT variables consistently', () => {
    for (const envName of ['local', 'dev', 'prod'] as const) {
      const env = envs.get(envName);
      expect(env, `env.${envName} section should exist`).toBeDefined();
      if (!env) continue;

      const name = parseTomlString(env.base.name);
      expect(name, `env.${envName} should set name`).toBeDefined();
      expect(name).toBe(`meiro-server-${envName}`);

      const envVar = parseTomlString(env.vars.ENVIRONMENT);
      expect(envVar, `env.${envName} should set vars.ENVIRONMENT`).toBeDefined();
      expect(envVar).toBe(envName);
    }
  });

  it('configures cloud routing for non-local environments', () => {
    for (const envName of ['dev', 'prod'] as const) {
      const env = envs.get(envName);
      expect(env, `env.${envName} section should exist`).toBeDefined();
      if (!env) continue;

      const route = parseTomlString(env.base.route);
      const routes = parseTomlArray(env.base.routes);
      expect(
        Boolean(route) || routes.length > 0,
        `env.${envName} should define route or routes`,
      ).toBe(true);
    }
  });
});
