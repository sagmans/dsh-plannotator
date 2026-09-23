/**
 * A command-registry stand-in that records what a handler returns.
 *
 * The handlers are the unit under test; the harness' own registry is not. A
 * stub keeps these tests from depending on the registry's logging, scoping, and
 * typed-remote layers, while still exercising the exact `CommandDefinition`
 * shape the real registry accepts.
 *
 * @module tests/helpers/context
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'

/** One registered definition, with its handler callable directly. */
export interface RegisteredCommand {
  readonly definition: CommandDefinition
  run(invocation: Partial<CommandInvocation> & { readonly rawInput: string }): Promise<CommandResult>
}

/** The stub registry plus its recorded registrations and log lines. */
export interface StubContext {
  readonly ctx: Context
  readonly commands: Map<string, RegisteredCommand>
  readonly logs: string[]
  readonly warnings: string[]
  readonly disposers: (() => void)[]
}

/**
 * Build a context whose `commands`, `logger`, and `effect` are the only real
 * surfaces the plugin touches.
 *
 * @returns the stub context and the state a test asserts on.
 */
export function stubContext(): StubContext {
  const commands = new Map<string, RegisteredCommand>()
  const logs: string[] = []
  const warnings: string[] = []
  const disposers: (() => void)[] = []

  const ctx = {
    logger: {
      info: (message: string) => logs.push(message),
      warn: (message: string) => warnings.push(message),
    },
    effect: (execute: () => () => void) => {
      const disposer = execute()
      disposers.push(disposer)
      return disposer
    },
    commands: {
      register: (definition: CommandDefinition) => {
        const entry: RegisteredCommand = {
          definition,
          run: async (invocation) =>
            definition.handler({
              commandId: 'test-command' as CommandInvocation['commandId'],
              agent: invocation.agent as CommandInvocation['agent'],
              rawInput: invocation.rawInput,
              attachments: [],
              signal: invocation.signal ?? new AbortController().signal,
            }),
        }
        commands.set(definition.name, entry)
        return () => {
          commands.delete(definition.name)
        }
      },
    },
  } as unknown as Context

  return { ctx, commands, logs, warnings, disposers }
}
