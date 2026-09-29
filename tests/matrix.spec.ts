/**
 * The harness matrix the manifest declares.
 *
 * The manifest is the only place the compatible range, the verified releases,
 * and the peers meet, so drift there is what ships: a peer that cannot reach the
 * line a profile runs makes that profile resolve this bundle's own copy of a
 * harness module beside the host's. These cases drive the shipped guard the way
 * CI does — through its command line, against a manifest written for the case —
 * so the rule under test is the rule that runs.
 *
 * @module tests/matrix.spec
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const GUARD = join(ROOT, 'tools', 'harness-matrix.mjs')

/** The line this bundle serves, and the releases that passed its gates. */
const RANGE = '>=0.1.5-rc.1 <0.3.0'
const VERIFIED_RELEASES = ['0.1.5-rc.2', '0.1.5-rc.3', '0.1.7-rc.2', '0.2.0-rc.2']

/** Fields a case may vary; every other rule keeps the shape the repository uses. */
interface ManifestChanges {
  readonly range?: string
  readonly releases?: Record<string, string>
  readonly peers?: Record<string, string>
  readonly dependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
}

/** A manifest the guard accepts, so a case varies one rule and nothing else. */
function manifestFor(changes: ManifestChanges): Record<string, unknown> {
  return {
    name: '@sagmans/dsh-plannotator',
    dsh: {
      compatibility: {
        dsh: changes.range ?? RANGE,
        dshReleases: changes.releases ?? Object.fromEntries(VERIFIED_RELEASES.map((release) => [release, 'compatible'])),
      },
    },
    dependencies: changes.dependencies ?? {},
    peerDependencies: changes.peers ?? { '@deepseek-ai/dsh-agent': RANGE },
    devDependencies: changes.devDependencies ?? { '@deepseek-ai/dsh-agent': '0.2.0-rc.2' },
  }
}

/** The problems the guard reports, or an empty list when it accepts the manifest. */
function problemsFor(changes: ManifestChanges): readonly string[] {
  const path = join(mkdtempSync(join(tmpdir(), 'dsh-plannotator-matrix-')), 'package.json')
  writeFileSync(path, JSON.stringify(manifestFor(changes), null, 2))
  try {
    execFileSync(process.execPath, [GUARD, '--manifest', path], { encoding: 'utf8', stdio: 'pipe' })
    return []
  } catch (error) {
    const failure = error as { readonly status?: number; readonly stderr?: string }
    assert.equal(failure.status, 1, 'the guard exited for a reason other than a rejected matrix')
    return String(failure.stderr ?? '').split('\n').filter((line) => line.trim().startsWith('-'))
  }
}

test('the manifest the repository ships satisfies every matrix rule', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(manifest.dsh.compatibility.dsh, RANGE)
  assert.deepEqual(Object.keys(manifest.dsh.compatibility.dshReleases), VERIFIED_RELEASES)
  // The plugin borrows its harness peers from the profile, so each one accepts
  // the whole line; a pinned peer would nest this bundle's own copy of it.
  for (const [name, declared] of Object.entries(manifest.peerDependencies as Record<string, string>)) {
    if (!name.startsWith('@deepseek-ai/dsh-')) continue
    assert.equal(declared, RANGE, name + ' does not accept the compatible range')
  }
  const reported = execFileSync(process.execPath, [GUARD], { encoding: 'utf8' })
  const compiled = manifest.devDependencies['@deepseek-ai/dsh-agent'] as string
  assert.match(reported, /harness-matrix: ok \(4 verified, compiled /u)
  assert.match(reported, new RegExp('compiled ' + compiled.replaceAll('.', '\\.') + '\\)', 'u'))
})

test('a verified release outside the compatible range is refused', () => {
  const reported = problemsFor({ range: '>=0.1.5-rc.1 <0.1.6' })
  // Both releases of the newer lines lie outside this narrowed range.
  assert.equal(reported.length, 3)
  assert.match(reported.join('\n'), /verified release 0\.1\.7-rc\.2 lies outside the compatible range/u)
})

test('an empty verified list is refused', () => {
  assert.match(problemsFor({ releases: {} }).join('\n'), /dshReleases must name at least one verified release/u)
})

test('a harness peer accepts the range or names one verified release', () => {
  assert.deepEqual(problemsFor({ peers: { '@deepseek-ai/dsh-agent': '0.1.7-rc.2' } }), [])
  assert.match(
    problemsFor({ peers: { '@deepseek-ai/dsh-agent': '^0.1.5' } }).join('\n'),
    /peerDependencies @deepseek-ai\/dsh-agent declares \^0\.1\.5, which is neither the compatible range/u,
  )
})

test('a mounted harness package accepts the range or names one verified release', () => {
  assert.deepEqual(problemsFor({ dependencies: { '@deepseek-ai/dsh-agent': '0.1.5-rc.3' } }), [])
  assert.match(
    problemsFor({ dependencies: { '@deepseek-ai/dsh-agent': '>=0.1.5-rc.1 <0.1.6' } }).join('\n'),
    /dependencies @deepseek-ai\/dsh-agent declares >=0\.1\.5-rc\.1 <0\.1\.6/u,
  )
})

test('an aliased install names a verified release', () => {
  assert.deepEqual(
    problemsFor({ dependencies: { '@sagmans/dsh-agent-017': 'npm:@deepseek-ai/dsh-agent@0.1.7-rc.2' } }),
    [],
  )
  assert.match(
    problemsFor({ dependencies: { '@sagmans/dsh-agent-017': 'npm:@deepseek-ai/dsh-agent@0.1.7-rc.1' } }).join('\n'),
    /aliased dependency @sagmans\/dsh-agent-017 declares npm:@deepseek-ai\/dsh-agent@0\.1\.7-rc\.1/u,
  )
})

test('the harness devDependencies name one verified release', () => {
  assert.match(
    problemsFor({ devDependencies: { '@deepseek-ai/dsh-agent': '0.1.5-rc.3', '@deepseek-ai/dsh-llm': '0.1.7-rc.2' } }).join('\n'),
    /the harness devDependencies name 2 versions, not one/u,
  )
  assert.match(
    problemsFor({ devDependencies: { '@deepseek-ai/dsh-agent': '0.1.7-rc.1' } }).join('\n'),
    /the harness devDependencies compile against 0\.1\.7-rc\.1, which is not a verified release/u,
  )
})
