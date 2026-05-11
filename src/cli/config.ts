/**
 * S83: CLI config loader.
 *
 * Loads JSON config file, then merges DOOW_TRACK_* env vars on top.
 * Env vars always win over config file values.
 *
 * Config file shape (JSON):
 * {
 *   "api_key": "dk_...",
 *   "endpoint": "https://api.doow.co",
 *   "attribution": { "team": "ml" },
 *   "input": { "mode": "file", "path": "/var/log/usage.jsonl" },
 *   "flush_at": 50
 * }
 */

import { readFile } from 'node:fs/promises';
import process from 'node:process';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CliInputConfig {
  mode: 'stdin' | 'file' | 'tcp';
  path?: string;
  port?: number;
}

export interface CliConfig {
  api_key: string;
  endpoint?: string;
  attribution?: Record<string, string | number | boolean>;
  input?: CliInputConfig;
  flush_at?: number;
  flush_interval?: number;
  debug?: boolean;
  disabled?: boolean;
}

/** Raw JSON file — all fields optional for partial configs */
type RawConfigFile = Partial<CliConfig>;

// ─── Loader ────────────────────────────────────────────────────────────────

/** Load and parse a JSON config file. Returns the parsed object. */
export async function loadConfigFile(filePath: string): Promise<RawConfigFile> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    throw new Error(`Cannot read config file "${filePath}": ${err.message}`);
  }

  try {
    return JSON.parse(content) as RawConfigFile;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    throw new Error(`Config file "${filePath}" is not valid JSON: ${err.message}`);
  }
}

// ─── Env var merge ─────────────────────────────────────────────────────────

/**
 * Merge DOOW_TRACK_* environment variables on top of a base config.
 * Env vars always take precedence.
 */
export function applyEnvOverrides(base: RawConfigFile): RawConfigFile {
  const env = process.env;
  const result: RawConfigFile = { ...base };

  if (env.DOOW_TRACK_API_KEY) {
    result.api_key = env.DOOW_TRACK_API_KEY;
  }
  if (env.DOOW_TRACK_ENDPOINT) {
    result.endpoint = env.DOOW_TRACK_ENDPOINT;
  }
  if (env.DOOW_TRACK_DISABLED === 'true') {
    result.disabled = true;
  }
  if (env.DOOW_TRACK_DEBUG === 'true') {
    result.debug = true;
  }
  if (env.DOOW_TRACK_FLUSH_AT !== undefined) {
    const n = parseInt(env.DOOW_TRACK_FLUSH_AT, 10);
    if (!isNaN(n) && n > 0) result.flush_at = n;
  }
  if (env.DOOW_TRACK_FLUSH_INTERVAL !== undefined) {
    const n = parseInt(env.DOOW_TRACK_FLUSH_INTERVAL, 10);
    if (!isNaN(n) && n > 0) result.flush_interval = n;
  }
  if (env.DOOW_TRACK_ATTRIBUTION !== undefined) {
    try {
      result.attribution = JSON.parse(env.DOOW_TRACK_ATTRIBUTION) as Record<string, string>;
    } catch {
      // Malformed — keep existing
    }
  }
  if (env.DOOW_TRACK_INPUT !== undefined) {
    const raw = env.DOOW_TRACK_INPUT;
    if (raw === 'stdin') {
      result.input = { mode: 'stdin' };
    } else if (raw.startsWith('file:')) {
      result.input = { mode: 'file', path: raw.slice('file:'.length) };
    } else if (raw.startsWith('tcp:')) {
      const port = parseInt(raw.slice('tcp:'.length), 10);
      if (!isNaN(port)) result.input = { mode: 'tcp', port };
    }
  }

  return result;
}

// ─── Validator ─────────────────────────────────────────────────────────────

/** Validate that a resolved config has the required fields. Throws on missing api_key. */
export function validateConfig(config: RawConfigFile): CliConfig {
  if (!config.api_key) {
    throw new Error(
      'api_key is required. Set it in your config file or via DOOW_TRACK_API_KEY env var.',
    );
  }
  return config as CliConfig;
}

// ─── Convenience ───────────────────────────────────────────────────────────

/**
 * Load config from file (optional), apply env overrides, validate.
 * Pass filePath=undefined for env-only mode (e.g. --api-key flag).
 */
export async function resolveConfig(
  filePath: string | undefined,
  cliOverrides: Partial<CliConfig> = {},
): Promise<CliConfig> {
  const fromFile: RawConfigFile = filePath ? await loadConfigFile(filePath) : {};
  // Order of precedence: env > CLI flags > config file
  const merged: RawConfigFile = { ...fromFile, ...cliOverrides };
  const withEnv = applyEnvOverrides(merged);
  return validateConfig(withEnv);
}
