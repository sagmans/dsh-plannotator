/**
 * Deliver a reviewer's words to the model.
 *
 * A command's result is rendered as one notice in the terminal surface, so it
 * cannot itself be the feedback channel: the model would never see it. Steering
 * is the harness seam that carries text into the conversation, and it is the
 * same seam `/plan <message>` uses, so the model sees the reviewer as a person
 * speaking rather than as a plugin mutating history.
 *
 * @module dsh-plannotator/feedback
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FEEDBACK_PREFIX, PLUGIN_NAME } from './constants.ts'
import type { ReviewOutcome } from './decisions.ts'

/**
 * Frame reviewer text so the model can attribute it.
 *
 * The prefix is the only provenance marker the model gets: without it, an
 * annotation quoted from a reviewed document is indistinguishable from the
 * reader's own instruction.
 *
 * @param target - what was reviewed, as the reviewer saw it.
 * @param body - the reviewer's text.
 * @returns the message body to steer.
 */
export function frameFeedback(target: string, body: string): string {
  return FEEDBACK_PREFIX + ' Reviewer feedback on ' + target + ':\n\n' + body.trim()
}

/**
 * Frame an approval that carried notes.
 *
 * @param target - what was reviewed.
 * @param notes - the notes written alongside the approval.
 * @returns the message body to steer.
 */
export function frameApprovalNotes(target: string, notes: string): string {
  return (
    FEEDBACK_PREFIX +
    ' The reviewer approved ' +
    target +
    ' and left these non-blocking implementation notes:\n\n' +
    notes.trim()
  )
}

/**
 * Hand text to the agent as a steering message.
 *
 * Steering targets the nearest step boundary, and an idle driver opens a turn
 * for it, so feedback lands whether the agent is mid-turn or waiting for input.
 *
 * @param agent - the agent whose session received the review.
 * @param text - the framed message body.
 */
export function steerText(agent: Agent, text: string): void {
  agent.steer(
    createUserMessage({
      content: [{ type: 'text', text }],
      // The words are the reviewer's, so the model must see them as user input;
      // a plugin-attributed source would read as the harness speaking.
      source: { kind: 'user' },
    }),
  )
}

/**
 * Decide whether an outcome produces a message for the model, and which one.
 *
 * Approvals are the case that needs a policy: plannotator treats notes on an
 * approval as guidance rather than a change request, and a profile may prefer
 * to keep them out of the conversation entirely.
 *
 * @param outcome - the settled review.
 * @param target - what was reviewed.
 * @param approveNotes - whether approval notes are forwarded.
 * @returns the message body, or `undefined` when nothing should be sent.
 */
export function feedbackFor(
  outcome: ReviewOutcome,
  target: string,
  approveNotes: 'steer' | 'ignore',
): string | undefined {
  const body = outcome.feedback.trim()
  if (outcome.decision === 'approved') {
    if (body === '' || approveNotes === 'ignore') return undefined
    return frameApprovalNotes(target, body)
  }
  if (body === '') return undefined
  return frameFeedback(target, body)
}

/** The plugin's log prefix, so a diagnostic names its origin. */
export const LOG_PREFIX = PLUGIN_NAME
