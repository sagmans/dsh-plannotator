/**
 * Recover the newest assistant message from the session log.
 *
 * The annotate-last surface reviews what the agent just said, and only this
 * process has that text. Deriving it from the session's own messages — rather
 * than from a stream buffer — is what makes the reviewed text the same text the
 * model produced, including anything a resume or fork restored.
 *
 * @module dsh-plannotator/transcript
 */

/** The part of a content block this module reads. */
export interface TextBlockLike {
  readonly type: string
  readonly text?: string
}

/** The part of a message this module reads. */
export interface MessageLike {
  readonly role: string
  readonly content: readonly TextBlockLike[]
}

/**
 * Join one message's text blocks.
 *
 * Non-text blocks (reasoning, tool results, attachments) are skipped: the
 * annotation surface renders prose, and a caller that passed them through would
 * hand the reviewer content the CLI cannot render.
 *
 * @param message - a message-shaped value.
 * @returns the message's text, trimmed, or an empty string when it has none.
 */
export function messageText(message: MessageLike): string {
  const parts: string[] = []
  for (const block of message.content) {
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n\n').trim()
}

/**
 * Find the newest assistant message with text.
 *
 * @param messages - the session's derived messages in order.
 * @returns the newest non-empty assistant text, or `undefined` when there is none yet.
 */
export function newestAssistantText(messages: readonly MessageLike[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message === undefined || message.role !== 'assistant') continue
    const text = messageText(message)
    if (text !== '') return text
  }
  return undefined
}
