#!/usr/bin/env node
/**
 * Package smoke test.
 *
 * A profile resolves this bundle through its manifest and its patch file, so
 * the tarball a user installs must carry both plus every module the entry point
 * imports. The packed archive is inspected rather than the checkout, because a
 * path that only exists before packing would still break the install.
 *
 * Usage: node tools/pack-smoke.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Entries a profile loader or a reader needs in the tarball. */
const REQUIRED = [
  'package/package.json',
  'package/cordis.patch.yml',
  'package/README.md',
  'package/LICENSE',
  'package/dist/index.js',
  'package/dist/commands.js',
  'package/dist/config.js',
  'package/dist/decisions.js',
]

/** Entries that must never ship: development inputs and local state. */
const FORBIDDEN = [
  /^package\/(src|tests|tools|node_modules|\.plans|\.github)\//u,
  /^package\/(tsconfig[^/]*\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc)$/u,
]

/** The bundle row this plugin owns, exactly as a profile loader resolves it. */
const PATCH_ROW = "name: '@sagmans/dsh-plannotator'"
const PATCH_ID = 'id: plannotator'

/** Dependency protocols that cannot be resolved from a registry tarball. */
const LOCAL_PROTOCOLS = ['link:', 'workspace:', 'file:']

/** Runtime dependencies this plugin promises not to have. */
const ALLOWED_RUNTIME_DEPENDENCIES = 0

function walk(directory) {
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...walk(path))
    else found.push(path)
  }
  return found
}

const problems = []
const out = mkdtempSync(join(tmpdir(), 'dsh-plannotator-pack-'))
try {
  execFileSync('pnpm', ['pack', '--pack-destination', out], { cwd: ROOT, stdio: 'inherit' })
  const tarball = readdirSync(out).find((name) => name.endsWith('.tgz'))
  if (tarball === undefined) throw new Error('pnpm pack produced no tarball')
  const archive = join(out, tarball)
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
    .split('\n')
    .filter((entry) => entry !== '')
  const read = (entry) => execFileSync('tar', ['-xOzf', archive, entry], { encoding: 'utf8' })

  for (const entry of REQUIRED) {
    if (!entries.includes(entry)) problems.push('missing from the tarball: ' + entry)
  }
  for (const entry of entries) {
    if (FORBIDDEN.some((pattern) => pattern.test(entry))) problems.push('should not ship: ' + entry)
  }

  const packed = JSON.parse(read('package/package.json'))
  if (packed.private === true) problems.push('the packed manifest is private, so npm would refuse it')
  const shipped = (target) =>
    typeof target === 'string' && entries.includes('package/' + target.replace(/^\.\//u, ''))
  const declared = packed.dsh?.bundle?.patch
  if (!shipped(declared)) problems.push('the manifest does not point at a bundle patch that ships')
  const declaredTargets = [
    ['main', packed.main],
    ['types', packed.types],
    ...Object.entries(packed.exports ?? {}).map(([key, value]) => [
      'exports["' + key + '"]',
      typeof value === 'string' ? value : value?.default,
    ]),
  ]
  for (const [label, target] of declaredTargets) {
    if (target === undefined) problems.push(label + ' is not declared in the packed manifest')
    else if (!shipped(target)) problems.push(label + ' points at ' + target + ', which is not in the tarball')
  }

  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(packed[field] ?? {})) {
      if (typeof spec === 'string' && LOCAL_PROTOCOLS.some((protocol) => spec.startsWith(protocol))) {
        problems.push(field + '.' + name + ' uses ' + spec.split(':')[0] + ':, which a registry install cannot resolve')
      }
    }
  }
  const runtime = Object.keys(packed.dependencies ?? {}).length
  if (runtime > ALLOWED_RUNTIME_DEPENDENCIES) {
    problems.push('the plugin ships ' + runtime + ' runtime dependencies; it promises none')
  }

  const patch = read('package/cordis.patch.yml')
  if (!patch.includes(PATCH_ROW)) problems.push('the bundle patch no longer names ' + PATCH_ROW)
  if (!patch.includes(PATCH_ID)) problems.push('the bundle patch no longer inserts ' + PATCH_ID)

  const modules = walk(join(ROOT, 'dist')).filter((file) => file.endsWith('.js'))
  for (const module of modules) execFileSync(process.execPath, ['--check', module], { stdio: 'inherit' })
  // A declaration file that the tarball omits is worse than no types at all:
  // editors would report the package as untyped while the manifest promises types.
  const declarations = walk(join(ROOT, 'dist')).filter((file) => file.endsWith('.d.ts'))
  for (const declaration of declarations) {
    const relative = 'package/' + declaration.slice(ROOT.length + 1)
    if (!entries.includes(relative)) problems.push('missing from the tarball: ' + relative)
  }

  console.log('\npacked ' + entries.length + ' entries, ' + modules.length + ' modules parse, ' + declarations.length + ' declarations ship')
  console.log('tarball: ' + archive)
} catch (error) {
  problems.push(error instanceof Error ? error.message : String(error))
} finally {
  rmSync(out, { recursive: true, force: true })
}

if (problems.length > 0) {
  console.error('\npack-smoke: the artefact is not shippable')
  for (const problem of problems) console.error('  - ' + problem)
  process.exit(1)
}
console.log('pack-smoke: ok')
