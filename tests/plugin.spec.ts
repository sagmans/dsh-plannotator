/**
 * The module's Loader-facing shape.
 *
 * @module tests/plugin.spec
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply, Config, inject, name } from '../src/index.ts'
import { COMMAND_ANNOTATE, COMMAND_LAST, COMMAND_PLAN, COMMAND_REVIEW, PLUGIN_NAME } from '../src/constants.ts'
import { stubContext } from './helpers/context.ts'

test('the bundle declares a Loader identity and the registry it needs', () => {
  assert.equal(name, PLUGIN_NAME)
  assert.deepEqual(inject, ['commands'])
  assert.ok(Config !== undefined)
})

test('apply registers every command as an effect of the mounting context', () => {
  const stub = stubContext()
  apply(stub.ctx, {})
  assert.deepEqual(
    [...stub.commands.keys()].sort(),
    [COMMAND_ANNOTATE, COMMAND_LAST, COMMAND_PLAN, COMMAND_REVIEW],
  )
  assert.equal(stub.logs.length, 1)
  // The loader disposes the effect on unload; the registration must go with it.
  for (const dispose of stub.disposers) dispose()
  assert.equal(stub.commands.size, 0)
})

test('a malformed config is normalized instead of crashing the mount', () => {
  const stub = stubContext()
  apply(stub.ctx, { binary: 7, reviewTimeoutMs: 'soon' })
  assert.equal(stub.commands.size, 4)
})
