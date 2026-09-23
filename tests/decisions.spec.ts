/**
 * Decision mapping for all three stdout/exit-code contracts.
 *
 * @module tests/decisions.spec
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RunResult } from '../src/cli.ts'
import {
  outcomeFromAnnotate,
  outcomeFromAnnotateLast,
  outcomeFromReview,
  readJsonRecord,
} from '../src/decisions.ts'

function exited(code: number, stdout: string, stderr = ''): RunResult {
  return {
    kind: 'exited',
    code,
    cancelled: false,
    stdout: { text: stdout, truncated: false },
    stderr: { text: stderr, truncated: false },
  }
}

test('the JSON record is read whole, or from its last parseable line', () => {
  assert.deepEqual(readJsonRecord('{"decision":"approved"}'), { decision: 'approved' })
  assert.deepEqual(readJsonRecord('warning: old server\n{"decision":"dismissed"}\n'), { decision: 'dismissed' })
  assert.equal(readJsonRecord('no record here'), undefined)
  assert.equal(readJsonRecord(''), undefined)
  assert.equal(readJsonRecord('[1,2]'), undefined)
})

test('annotate exit codes are the verdict, with feedback carried through', () => {
  assert.deepEqual(outcomeFromAnnotate(exited(0, '{"decision":"approved","feedback":"ship it"}')), {
    ok: true,
    outcome: { decision: 'approved', feedback: 'ship it' },
  })
  assert.deepEqual(outcomeFromAnnotate(exited(1, '{"decision":"annotated","feedback":"fix the loop"}')), {
    ok: true,
    outcome: { decision: 'annotated', feedback: 'fix the loop' },
  })
  assert.deepEqual(outcomeFromAnnotate(exited(1, '{"decision":"dismissed"}')), {
    ok: true,
    outcome: { decision: 'dismissed', feedback: '' },
  })
})

test('a record-less decline is still a decline', () => {
  assert.deepEqual(outcomeFromAnnotate(exited(1, '')), {
    ok: true,
    outcome: { decision: 'annotated', feedback: '' },
  })
})

test('exit 2 is a gate failure, not a reviewer outcome', () => {
  const mapped = outcomeFromAnnotate(exited(2, '', 'plannotator: no such file'))
  assert.equal(mapped.ok, false)
  if (!mapped.ok) assert.match(mapped.error, /could not start: plannotator: no such file/u)
})

test('an unexpected exit is reported with the stream tail', () => {
  const mapped = outcomeFromAnnotate(exited(7, '', 'boom'))
  assert.equal(mapped.ok, false)
  if (!mapped.ok) assert.match(mapped.error, /exit 7/u)
})

test('a cancelled run never reads as an approval', () => {
  const cancelled: RunResult = {
    kind: 'exited',
    code: 0,
    cancelled: true,
    stdout: { text: '{"decision":"approved"}', truncated: false },
    stderr: { text: '', truncated: false },
  }
  const mapped = outcomeFromAnnotate(cancelled)
  assert.equal(mapped.ok, false)
  if (!mapped.ok) assert.match(mapped.error, /cancelled/u)
})

test('a signalled run names the signal', () => {
  const mapped = outcomeFromAnnotate({
    kind: 'signalled',
    signal: 'SIGKILL',
    cancelled: false,
    stdout: { text: '', truncated: false },
    stderr: { text: '', truncated: false },
  })
  assert.equal(mapped.ok, false)
  if (!mapped.ok) assert.match(mapped.error, /SIGKILL/u)
})

test('annotate-last trusts the record and refuses to guess without one', () => {
  assert.deepEqual(outcomeFromAnnotateLast(exited(0, '{"decision":"annotated","feedback":"tighten §2"}')), {
    ok: true,
    outcome: { decision: 'annotated', feedback: 'tighten §2' },
  })
  const withoutRecord = outcomeFromAnnotateLast(exited(1, ''))
  assert.equal(withoutRecord.ok, false)
  const recordlessSuccess = outcomeFromAnnotateLast(exited(0, ''))
  assert.deepEqual(recordlessSuccess, { ok: true, outcome: { decision: 'dismissed', feedback: '' } })
})

test('review carries the rendered message and ignores its exit code', () => {
  assert.deepEqual(outcomeFromReview(exited(0, '{"decision":"approved","message":"The user approved."}')), {
    ok: true,
    outcome: { decision: 'approved', feedback: 'The user approved.' },
  })
  assert.deepEqual(outcomeFromReview(exited(3, '{"decision":"annotated","message":"change the parser"}')), {
    ok: true,
    outcome: { decision: 'annotated', feedback: 'change the parser' },
  })
  const missing = outcomeFromReview(exited(0, 'plaintext only'))
  assert.equal(missing.ok, false)
})

test('an unknown decision string is never accepted as a verdict', () => {
  assert.equal(outcomeFromReview(exited(0, '{"decision":"maybe","message":""}')).ok, false)
})
