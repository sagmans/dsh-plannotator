/**
 * Config defaults and the two derived paths.
 *
 * @module tests/config.spec
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import {
  CONFIG_DEFAULTS,
  normalizeConfig,
  resolveDataDir,
  resolvePlansDir,
} from '../src/config.ts'
import { DATA_DIR_ENV } from '../src/constants.ts'

test('an absent config resolves to the shipped defaults', () => {
  assert.deepEqual(normalizeConfig(undefined), CONFIG_DEFAULTS)
  assert.deepEqual(normalizeConfig('nonsense'), CONFIG_DEFAULTS)
})

test('malformed fields fall back instead of reaching a command line', () => {
  const resolved = normalizeConfig({
    binary: 42,
    dataDir: null,
    reviewTimeoutMs: -1,
    maxInputBytes: 1.5,
    tailscale: 'yes',
    approveNotes: 'whatever',
    steerFeedback: false,
  })
  assert.equal(resolved.binary, '')
  assert.equal(resolved.dataDir, '')
  assert.equal(resolved.reviewTimeoutMs, 0)
  assert.equal(resolved.maxInputBytes, CONFIG_DEFAULTS.maxInputBytes)
  assert.equal(resolved.tailscale, false)
  assert.equal(resolved.approveNotes, 'steer')
  // Only the field the profile actually set survives.
  assert.equal(resolved.steerFeedback, false)
})

test('config outranks the environment for the data directory', () => {
  const env = { [DATA_DIR_ENV]: '/env/dir' }
  assert.equal(resolveDataDir(normalizeConfig({ dataDir: '/config/dir' }), env, '/home/u'), '/config/dir')
  assert.equal(resolveDataDir(normalizeConfig({}), env, '/home/u'), '/env/dir')
  assert.equal(resolveDataDir(normalizeConfig({}), {}, '/home/u'), join('/home/u', '.plannotator'))
})

test('plan snapshots never land beside the CLI own plan archive', () => {
  assert.equal(resolvePlansDir('/data'), join('/data', 'dsh', 'plans'))
})
