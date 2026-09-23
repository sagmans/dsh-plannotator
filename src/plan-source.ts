/**
 * Recover the newest plan from the session log.
 *
 * On-demand review is only useful if the reader does not have to find the plan
 * file themselves. Plan mode's exit tool is the one place a plan is recorded as
 * the model wrote it, and it stays registered while plan mode is inactive, so
 * its newest call is also the newest plan this session produced.
 *
 * @module dsh-plannotator/plan-source
 */

import { EXIT_PLAN_MODE_TOOL } from './constants.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Extract the plan text from one `tool/call` event.
 *
 * The arguments are the raw JSON string the model produced — the harness stores
 * them unparsed — so a call this plugin cannot parse is skipped rather than
 * failing the command: an unreadable older call must not hide a readable newer
 * one.
 *
 * @param event - candidate session event.
 * @returns the plan markdown, or `undefined` when the event is not a readable plan call.
 */
export function planFromToolCall(event: unknown): string | undefined {
  if (!isRecord(event) || event['type'] !== 'tool/call') return undefined
  const data = event['data']
  if (!isRecord(data) || data['name'] !== EXIT_PLAN_MODE_TOOL) return undefined
  const raw = data['arguments']
  if (typeof raw !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return undefined
    const plan = parsed['plan']
    return typeof plan === 'string' && plan.trim() !== '' ? plan : undefined
  } catch {
    return undefined
  }
}

/**
 * Find the newest plan in a session log.
 *
 * @param events - the session's events in sequence order.
 * @returns the newest plan markdown, or `undefined` when the session has none.
 */
export function newestPlan(events: readonly unknown[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const plan = planFromToolCall(events[index])
    if (plan !== undefined) return plan
  }
  return undefined
}
