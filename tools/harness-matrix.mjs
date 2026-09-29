#!/usr/bin/env node
/**
 * Harness matrix guard.
 *
 * The plugin runs inside a harness it does not ship: its peers accept the whole
 * compatible line, and its sources compile against one verified release of it.
 * A tree where the declared range, the verified list, and that release disagree
 * is how a profile ends up resolving this bundle's own copy of a harness module
 * beside the host's. A peer or a mounted package can only accept the whole line
 * when a single comparator reaches it, and npm admits a prerelease only through
 * a comparator naming that exact `X.Y.Z` tuple: `>=0.1.5-rc.1 <0.2.0` resolves
 * `0.1.5-rc.3` and never a `0.1.7` prerelease, so a row that must serve the
 * newer line names one verified release instead, the way the harness's own
 * bundles pin.
 *
 * The default mode checks the matrix offline. --check-registry also reads the
 * release the registry serves as latest, so a harness that moves past the
 * verified list fails on schedule rather than at a user's install.
 *
 * Usage: node tools/harness-matrix.mjs [--manifest <path>] [--check-registry]
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const argv = process.argv.slice(2)
/** A spec drives fixture manifests through these rules; every run defaults to this checkout. */
const manifestAt = argv.indexOf('--manifest')
const manifestPath =
  manifestAt >= 0 && argv[manifestAt + 1] !== undefined ? argv[manifestAt + 1] : join(ROOT, 'package.json')

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const compatibility = manifest.dsh?.compatibility?.dsh
const releases = Object.keys(manifest.dsh?.compatibility?.dshReleases ?? {})
const problems = []

/** Orders X.Y.Z[-tag.N] with semver's rule that a prerelease precedes its release. */
function compareVersions(left, right) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/u.exec(value ?? '')
    if (match === null) throw new Error('unsupported version: ' + String(value))
    return {
      numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
      prerelease: match[4] === undefined ? null : [match[4], Number(match[5])],
    }
  }
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < a.numbers.length; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] - b.numbers[index]
  }
  if (a.prerelease === null) return b.prerelease === null ? 0 : 1
  if (b.prerelease === null) return -1
  if (a.prerelease[0] !== b.prerelease[0]) return a.prerelease[0] < b.prerelease[0] ? -1 : 1
  return a.prerelease[1] - b.prerelease[1]
}

const range = /^>=(\S+) <(\S+)$/u.exec(compatibility ?? '')
if (range === null) {
  problems.push('dsh.compatibility.dsh must declare a ">=lower <upper" range, found ' + String(compatibility))
}
if (releases.length === 0) {
  problems.push('dsh.compatibility.dshReleases must name at least one verified release')
}
if (range !== null) {
  for (const release of releases) {
    if (compareVersions(release, range[1]) < 0 || compareVersions(release, range[2]) >= 0) {
      problems.push('verified release ' + release + ' lies outside the compatible range ' + compatibility)
    }
  }
}

/** Harness packages are the ones this plugin can only borrow from the profile. */
const isHarnessPackage = (name) => name.startsWith('@deepseek-ai/dsh-')

// A row either accepts the whole compatible line or names one verified release.
// The range is the one the 0.1.5 line resolves; a row that serves the newer line
// cannot use it, so it names the release this tree is verified against instead.
for (const field of ['dependencies', 'peerDependencies']) {
  for (const [name, declared] of Object.entries(manifest[field] ?? {})) {
    if (!isHarnessPackage(name)) continue
    if (declared !== compatibility && !releases.includes(declared)) {
      problems.push(field + ' ' + name + ' declares ' + declared
        + ', which is neither the compatible range ' + String(compatibility) + ' nor a verified release')
    }
  }
}

// An aliased install carries the release of the line no range can reach.
for (const [name, declared] of Object.entries(manifest.dependencies ?? {})) {
  if (!String(declared).startsWith('npm:')) continue
  const aliased = /^npm:(.+)@([^@]+)$/u.exec(String(declared))
  if (aliased === null || !releases.includes(aliased[2])) {
    problems.push('aliased dependency ' + name + ' declares ' + declared + ', whose version is not a verified release')
  }
}

const compiled = Object.entries(manifest.devDependencies ?? {}).filter(([name]) => isHarnessPackage(name))
if (compiled.length === 0) problems.push('the manifest compiles against no harness package')
const compiledVersions = new Set(compiled.map(([, declared]) => declared))
if (compiledVersions.size !== 1) {
  problems.push('the harness devDependencies name ' + compiledVersions.size + ' versions, not one')
}
for (const version of compiledVersions) {
  if (!releases.includes(version)) {
    problems.push('the harness devDependencies compile against ' + version + ', which is not a verified release')
  }
}

if (argv.includes('--check-registry')) {
  const response = await fetch('https://registry.npmjs.org/@deepseek-ai%2Fdsh')
  if (!response.ok) {
    problems.push('the registry read failed with HTTP ' + response.status)
  } else {
    const metadata = await response.json()
    const latest = metadata['dist-tags']?.latest
    if (typeof latest !== 'string') {
      problems.push('the registry answered no latest dist-tag')
    } else if (!releases.includes(latest)) {
      problems.push('the harness publishes ' + latest + ' as latest, which is not a verified release')
      console.error('harness-matrix: add it to dsh.compatibility.dshReleases, raise the harness devDependencies and any row that names a release, then dogfood; RELEASE.md owns the procedure')
    } else {
      console.log('harness-matrix: registry latest ' + latest + ' is verified')
    }
  }
}

if (problems.length > 0) {
  console.error('harness-matrix: the matrix is inconsistent')
  for (const problem of problems) console.error('  - ' + problem)
  process.exit(1)
}
console.log('harness-matrix: ok (' + releases.length + ' verified, compiled ' + [...compiledVersions].join(', ') + ')')
