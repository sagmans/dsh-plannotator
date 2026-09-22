/**
 * Typed-line parsing and argv building: the plugin's half of the CLI contract.
 *
 * @module tests/args.spec
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildAnnotateArgs,
  buildAnnotateLastArgs,
  buildReviewArgs,
  classifyTarget,
  parseTypedLine,
  REVIEW_FLAGS,
  ANNOTATE_FLAGS,
} from '../src/args.ts'

const plain = { tailscale: false }
const tailnet = { tailscale: true }

test('flags with values consume the next token and keep their order', () => {
  const parsed = parseTypedLine(['--base', 'feature/a', '--no-local', 'https://github.com/o/r/pull/1'], REVIEW_FLAGS)
  assert.deepEqual(parsed, {
    ok: true,
    value: { flags: ['--base', 'feature/a', '--no-local'], positionals: ['https://github.com/o/r/pull/1'] },
  })
})

test('an unknown flag is refused with the accepted list', () => {
  const parsed = parseTypedLine(['--evil', 'x'], REVIEW_FLAGS)
  assert.equal(parsed.ok, false)
  if (!parsed.ok) assert.match(parsed.error, /unknown option --evil; accepted: --git --gitbutler/u)
})

test('a value-taking flag without a value is refused', () => {
  const parsed = parseTypedLine(['--base'], REVIEW_FLAGS)
  assert.equal(parsed.ok, false)
})

test('annotate flags are allowlisted apart from review flags', () => {
  assert.equal(parseTypedLine(['--markdown'], ANNOTATE_FLAGS).ok, true)
  const crossed = parseTypedLine(['--markdown'], REVIEW_FLAGS)
  assert.equal(crossed.ok, false)
})

test('gate and json flags are appended by the plugin, never typed', () => {
  const argv = buildAnnotateArgs('/plans/p.md', plain)
  assert.deepEqual(argv, ['annotate', '/plans/p.md', '--gate', '--json', '--require-approval'])
  assert.deepEqual(buildAnnotateLastArgs(plain), ['annotate-last', '--stdin', '--gate', '--json'])
})

test('the strict exit-code contract is only requested for annotate', () => {
  assert.equal(buildAnnotateArgs('/plans/p.md', plain).includes('--require-approval'), true)
  assert.equal(buildAnnotateLastArgs(plain).includes('--require-approval'), false)
})

test('tailscale is appended only when in force', () => {
  assert.equal(buildAnnotateArgs('/p.md', tailnet).at(-1), '--tailscale')
  assert.equal(buildAnnotateArgs('/p.md', plain).includes('--tailscale'), false)
  assert.equal(buildReviewArgs({ flags: [], positionals: [] }, tailnet).includes('--tailscale'), true)
})

test('review argv keeps the reviewer flags and asks for JSON last', () => {
  const argv = buildReviewArgs({ flags: ['--base', 'main'], positionals: [] }, plain)
  assert.deepEqual(argv, ['review', '--base', 'main', '--json'])
})

test('targets are split into URLs, paths, and refusals', () => {
  assert.equal(classifyTarget('https://example.com/x.md'), 'url')
  assert.equal(classifyTarget('http://localhost:3000/'), 'url')
  assert.equal(classifyTarget('docs/notes.md'), 'path')
  assert.equal(classifyTarget('file:///etc/passwd'), undefined)
  assert.equal(classifyTarget('--markdown'), undefined)
  assert.equal(classifyTarget(''), undefined)
})
