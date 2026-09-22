/**
 * Executable resolution order and the trust rules around it.
 *
 * @module tests/binary.spec
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveBinary, type BinaryProbe } from '../src/binary.ts'
import { BINARY_ENV } from '../src/constants.ts'

const UID = 501

/** A probe over an in-memory filesystem: path -> { mode, uid, executable }. */
function probe(files: Record<string, { mode?: number; uid?: number; executable?: boolean }>): BinaryProbe {
  return {
    isExecutable: (path) => files[path] !== undefined && files[path]?.executable !== false,
    stat: (path) => {
      const entry = files[path]
      if (entry === undefined) throw new Error('ENOENT ' + path)
      return { mode: entry.mode ?? 0o755, uid: entry.uid ?? UID }
    },
  }
}

test('a configured path wins over the environment and PATH', () => {
  const result = resolveBinary({
    configured: '/opt/plannotator',
    allowUntrusted: false,
    env: { [BINARY_ENV]: '/env/plannotator', PATH: '/usr/bin' },
    cwd: '/work',
    uid: UID,
    probe: probe({
      '/opt/plannotator': {},
      '/env/plannotator': {},
      '/usr/bin/plannotator': {},
    }),
  })
  assert.deepEqual(result, { ok: true, path: '/opt/plannotator' })
})

test('a relative configured path resolves against the session directory', () => {
  const result = resolveBinary({
    configured: './tools/plannotator',
    allowUntrusted: false,
    env: {},
    cwd: '/work',
    uid: UID,
    probe: probe({ '/work/tools/plannotator': {} }),
  })
  assert.deepEqual(result, { ok: true, path: '/work/tools/plannotator' })
})

test('PATH is searched in order and skips missing entries', () => {
  const result = resolveBinary({
    configured: '',
    allowUntrusted: false,
    env: { PATH: '/first:/second' },
    cwd: '/work',
    uid: UID,
    probe: probe({ '/second/plannotator': {} }),
  })
  assert.deepEqual(result, { ok: true, path: '/second/plannotator' })
})

test('nothing found is reported with the search order', () => {
  const result = resolveBinary({
    configured: '',
    allowUntrusted: false,
    env: { PATH: '/usr/bin' },
    cwd: '/work',
    uid: UID,
    probe: probe({}),
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reason, /^plannotator was not found \(config\.binary, \$PLANNOTATOR_BIN, then PATH\)$/u)
})

test('a world-writable binary is refused, and the override is named', () => {
  const result = resolveBinary({
    configured: '/opt/plannotator',
    allowUntrusted: false,
    env: {},
    cwd: '/work',
    uid: UID,
    probe: probe({ '/opt/plannotator': { mode: 0o777 } }),
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reason, /writable by other users/u)
  assert.match(result.ok === false ? result.reason : '', /allowUntrustedBinary/u)
})

test('a foreign owner is refused unless the profile allows it', () => {
  const files = { '/opt/plannotator': { uid: UID + 1 } }
  const refused = resolveBinary({ configured: '/opt/plannotator', allowUntrusted: false, env: {}, cwd: '/work', uid: UID, probe: probe(files) })
  assert.equal(refused.ok, false)
  const allowed = resolveBinary({ configured: '/opt/plannotator', allowUntrusted: true, env: {}, cwd: '/work', uid: UID, probe: probe(files) })
  assert.deepEqual(allowed, { ok: true, path: '/opt/plannotator' })
})

test('an explicit path that is not executable is refused rather than skipped', () => {
  const result = resolveBinary({
    configured: '/opt/plannotator',
    allowUntrusted: false,
    env: {},
    cwd: '/work',
    uid: UID,
    probe: probe({ '/opt/plannotator': { executable: false }, '/usr/bin/plannotator': {} }),
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reason, /not an executable file/u)
})
