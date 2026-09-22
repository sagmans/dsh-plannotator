/**
 * Recovering the newest assistant text.
 *
 * @module tests/transcript.spec
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { messageText, newestAssistantText } from '../src/transcript.ts'

test('only text blocks are joined', () => {
  assert.equal(
    messageText({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'ignored' },
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ],
    }),
    'hello\n\nworld',
  )
})

test('the newest non-empty assistant message wins', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'do it' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'first' }] },
    { role: 'assistant', content: [{ type: 'reasoning', text: 'thinking' }] },
    { role: 'assistant', content: [{ type: 'text', text: '  ' }] },
  ]
  assert.equal(newestAssistantText(messages), 'first')
  assert.equal(newestAssistantText([]), undefined)
  assert.equal(newestAssistantText([{ role: 'user', content: [{ type: 'text', text: 'x' }] }]), undefined)
})
