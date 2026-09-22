/**
 * The built artefact, loaded the way a profile loads it.
 *
 * The TypeScript suite runs against `src`, so it cannot catch a build that
 * emits an entry point with a broken import, a missing export, or a schema that
 * no longer validates. This test imports `dist` directly and mounts it through
 * a stub command registry: what a user installs is what this asserts.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply, Config, inject, name } from '../dist/index.js'
import { COMMAND_ANNOTATE, COMMAND_LAST, COMMAND_PLAN, COMMAND_REVIEW } from '../dist/constants.js'

/** The smallest context the entry point touches: a registry, a logger, an effect scope. */
function stubContext() {
  const commands = new Map()
  const logs = []
  const disposers = []
  return {
    commands,
    logs,
    disposers,
    ctx: {
      logger: { info: (message) => logs.push(message), warn: () => {} },
      effect: (execute) => {
        const disposer = execute()
        disposers.push(disposer)
        return disposer
      },
      commands: {
        register: (definition) => {
          commands.set(definition.name, definition)
          return () => commands.delete(definition.name)
        },
      },
    },
  }
}

test('the built entry point mounts and registers every command', () => {
  assert.equal(name, 'plannotator')
  assert.deepEqual(inject, ['commands'])
  assert.ok(Config !== undefined)
  const stub = stubContext()
  apply(stub.ctx, {})
  assert.deepEqual(
    [...stub.commands.keys()].sort(),
    [COMMAND_ANNOTATE, COMMAND_LAST, COMMAND_PLAN, COMMAND_REVIEW],
  )
  for (const dispose of stub.disposers) dispose()
  assert.equal(stub.commands.size, 0)
})

test('every registered command declares a handler and a description', () => {
  const stub = stubContext()
  apply(stub.ctx, {})
  for (const definition of stub.commands.values()) {
    assert.equal(typeof definition.handler, 'function', definition.name + ' has no handler')
    assert.equal(typeof definition.description, 'string', definition.name + ' has no description')
    assert.ok(definition.description.length > 0)
  }
})
