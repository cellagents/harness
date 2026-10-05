import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  harness: { port: number; thinClientDist: string; frontendPublic: string };
  mcp: { url: string };
  gameServer: { publicUrl: string };
  llm: { baseUrl: string; apiKey: string; defaultModel: string; models: string[] };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Config loading order:
 *   1. file at CELLAGENTS_HARNESS_CONFIG (if set)
 *   2. config.json next to the source
 *   3. config.example.json next to the source (the shipped defaults)
 * Then env vars override individual leaves so docker-compose can wire things
 * without mounting a file.
 */
export function loadConfig(): Config {
  const envPath = process.env.CELLAGENTS_HARNESS_CONFIG;
  const candidates = [
    envPath,
    path.resolve(__dirname, '../config.json'),
    path.resolve(__dirname, '../config.example.json')
  ].filter((p): p is string => typeof p === 'string');

  let cfg: Config | null = null;
  let base = __dirname;
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      cfg = JSON.parse(fs.readFileSync(p, 'utf8')) as Config;
      base = path.dirname(p);
      break;
    }
  }
  if (!cfg) throw new Error('No harness config file found; set CELLAGENTS_HARNESS_CONFIG or create config.json');

  // Resolve relative paths from the config's own directory (makes
  // config.example.json work both during dev and after the harness is
  // installed into /opt/cellagents inside the image).
  cfg.harness.thinClientDist = path.resolve(base, cfg.harness.thinClientDist);
  cfg.harness.frontendPublic = path.resolve(base, cfg.harness.frontendPublic);

  // Env overrides.
  if (process.env.HARNESS_PORT) cfg.harness.port = Number(process.env.HARNESS_PORT);
  if (process.env.HARNESS_THIN_CLIENT_DIST) cfg.harness.thinClientDist = path.resolve(process.env.HARNESS_THIN_CLIENT_DIST);
  if (process.env.HARNESS_FRONTEND_PUBLIC) cfg.harness.frontendPublic = path.resolve(process.env.HARNESS_FRONTEND_PUBLIC);
  if (process.env.MCP_URL) cfg.mcp.url = process.env.MCP_URL;
  if (process.env.GAME_SERVER_PUBLIC_URL) cfg.gameServer.publicUrl = process.env.GAME_SERVER_PUBLIC_URL;
  if (process.env.LLM_BASE_URL) cfg.llm.baseUrl = process.env.LLM_BASE_URL;
  if (process.env.LLM_API_KEY) cfg.llm.apiKey = process.env.LLM_API_KEY;
  if (process.env.LLM_DEFAULT_MODEL) cfg.llm.defaultModel = process.env.LLM_DEFAULT_MODEL;
  if (process.env.LLM_MODELS) cfg.llm.models = process.env.LLM_MODELS.split(',').map(s => s.trim()).filter(Boolean);
  return cfg;
}
