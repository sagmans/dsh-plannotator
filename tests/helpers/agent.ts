/**
 * Minimal Agent and Session stand-ins.
 *
 * Handlers read exactly three things from an agent — its session header's cwd,
 * its session id, its event log, and its derived messages — so the stub exposes
 * those and records what was steered. Using the real Agent would drag in the
 * agent registry, a driver loop, and a model route for a test that only checks
 * which text a reviewer's feedback became.
 *
 * @module tests/helpers/agent
 */

import type { Agent } from '@deepseek-ai/dsh-agent'

/** What a test can inspect after a handler ran. */
export interface AgentStub {
  readonly agent: Agent
  readonly steered: string[]
}

/** Options for building a stub agent. */
export interface AgentStubOptions {
  readonly cwd?: string
  readonly sessionId?: string
  readonly events?: readonly unknown[]
  readonly messages?: readonly unknown[]
}

/**
 * Build an agent stub.
 *
 * @param options - session facts a test wants the handler to observe.
 * @returns the stub agent and the text steered into it.
 */
export function agentStub(options: AgentStubOptions = {}): AgentStub {
  const steered: string[] = []
  const agent = {
    session: {
      id: options.sessionId ?? 'session-1',
      header: { cwd: options.cwd ?? '/tmp/plannotator-test' },
      snapshotEvents: () => options.events ?? [],
      deriveMessages: () => options.messages ?? [],
    },
    steer: (message: { content: readonly { type: string; text?: string }[] }) => {
      const text = message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('')
      steered.push(text)
    },
  } as unknown as Agent
  return { agent, steered }
}
