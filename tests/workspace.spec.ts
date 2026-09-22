/**
 * Snapshot naming, atomic writes, and the permissions of both.
 *
 * @module tests/workspace.spec
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  planSnapshotPath,
  sessionSegment,
  writePlanSnapshot,
  type SnapshotIo,
} from '../src/workspace.ts'

test('a session id cannot escape the plans directory', () => {
  assert.equal(sessionSegment('../../etc/passwd'), 'etc_passwd')
  assert.equal(sessionSegment('a/b\\c'), 'a_b_c')
  assert.equal(sessionSegment('.hidden'), 'hidden')
  assert.equal(sessionSegment(''), 'session')
  assert.equal(sessionSegment('!!!'), 'session')
  assert.equal(sessionSegment('x'.repeat(400)).length, 120)
})

test('one session always reviews at one path', () => {
  assert.equal(planSnapshotPath('/data/dsh/plans', 'abc'), join('/data/dsh/plans', 'abc.md'))
  assert.equal(planSnapshotPath('/data/dsh/plans', 'abc'), planSnapshotPath('/data/dsh/plans', 'abc'))
})

test('the snapshot is written privately and atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plannotator-workspace-'))
  try {
    const result = writePlanSnapshot(dir, 'session-1', '# The plan\n')
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(readFileSync(result.path, 'utf8'), '# The plan\n')
    // 0o600: a plan names internal hosts and credentials, so nobody else may read it.
    assert.equal(statSync(result.path).mode & 0o777, 0o600)
    assert.equal(statSync(dir).mode & 0o777, 0o700)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a second plan for the same session replaces the first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plannotator-workspace-'))
  try {
    const first = writePlanSnapshot(dir, 's', 'one')
    const second = writePlanSnapshot(dir, 's', 'two')
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    if (!second.ok) return
    assert.equal(readFileSync(second.path, 'utf8'), 'two')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a failed rename leaves a failure, never a half-written plan', () => {
  const calls: string[] = []
  const io: SnapshotIo = {
    mkdir: (path) => calls.push('mkdir ' + path),
    writeFile: (path) => calls.push('write ' + path),
    rename: (from) => {
      calls.push('rename ' + from)
      throw new Error('EXDEV')
    },
  }
  const result = writePlanSnapshot('/data/plans', 's', 'text', io)
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /EXDEV/u)
  // The rename is attempted after the write; nothing is reported as the final path.
  assert.equal(calls.length, 3)
})
