import assert from 'node:assert/strict';
import { test } from 'node:test';

test('build worker settings are opt-in and reject invalid counts', async () => {
  const original = process.env.NINEROUTER_BUILD_CPUS;
  try {
    for (const [value, expected] of [['', undefined], ['0', undefined], ['bad', undefined], ['1', 1]]) {
      process.env.NINEROUTER_BUILD_CPUS = value;
      const { default: config } = await import(`../../next.config.mjs?cpus=${value}`);
      assert.equal(config.experimental.cpus, expected);
      if (expected) {
        assert.equal(config.experimental.webpackMemoryOptimizations, true);
        assert.equal(config.experimental.webpackBuildWorker, true);
        assert.equal(config.experimental.parallelServerCompiles, false);
        assert.equal(config.experimental.parallelServerBuildTraces, false);
      }
    }
  } finally {
    if (original === undefined) delete process.env.NINEROUTER_BUILD_CPUS;
    else process.env.NINEROUTER_BUILD_CPUS = original;
  }
});
