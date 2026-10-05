import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import type { Config } from './config.js';
import { computeCost } from './cost.js';

const baseConfig: Config = {
  harness: { port: 0, thinClientDist: '/x', frontendPublic: '/x' },
  mcp: { url: 'http://x' },
  gameServer: { publicUrl: 'http://x' },
  llm: { baseUrl: 'http://x', apiKey: 'x', defaultModel: 'm', models: ['m'] },
  cost: {
    modelTiers: { default: 1.0, cheap: 0.5, pricey: 2.5 },
    tokensPerCostUnit: 100
  }
};

test('computeCost multiplies tier by (prompt + response) / tokensPerCostUnit', () => {
  const cost = computeCost(baseConfig, { model: 'cheap', promptTokens: 100, responseTokens: 100 });
  // tier 0.5 × (200 / 100) = 1.0
  assert.equal(cost, 1.0);
});

test('computeCost falls back to default tier for unknown models', () => {
  const cost = computeCost(baseConfig, { model: 'wat', promptTokens: 100, responseTokens: 0 });
  // tier 1.0 × (100 / 100) = 1.0
  assert.equal(cost, 1.0);
});

test('computeCost scales linearly with tier', () => {
  const cheap = computeCost(baseConfig, { model: 'cheap', promptTokens: 100, responseTokens: 0 });
  const pricey = computeCost(baseConfig, { model: 'pricey', promptTokens: 100, responseTokens: 0 });
  assert.equal(pricey / cheap, 2.5 / 0.5);
});

test('computeCost clamps negative token counts to zero', () => {
  const cost = computeCost(baseConfig, { model: 'cheap', promptTokens: -50, responseTokens: 100 });
  assert.equal(cost, 0.5 * (100 / 100));
});
