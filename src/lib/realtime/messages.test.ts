import { describe, expect, it } from 'vitest'

import {
  canBroadcastPageDocMessage,
  createPageDocBroadcast,
  createPageDocSessionFromHeaders,
  parsePageDocSocketMessage,
} from './messages'

describe('realtime page messages', () => {
  it('creates sessions from forwarded route headers', () => {
    const headers = new Headers({
      'x-potion-page-id': 'page_private_workspace',
      'x-potion-user-id': 'user_david',
      'x-potion-client-id': 'client_1',
    })

    expect(createPageDocSessionFromHeaders(headers)).toEqual({
      pageId: 'page_private_workspace',
      userId: 'user_david',
      clientId: 'client_1',
    })
    expect(createPageDocSessionFromHeaders(new Headers())).toBeNull()
  })

  it('parses and authorizes same-page client messages', () => {
    const parsed = parsePageDocSocketMessage(
      JSON.stringify({
        type: 'block:update',
        pageId: 'page_private_workspace',
        clientId: 'client_1',
        payload: { blockId: 'block_summary' },
      }),
    )

    expect(parsed.success).toBe(true)

    if (!parsed.success) {
      return
    }

    expect(
      canBroadcastPageDocMessage(
        {
          pageId: 'page_private_workspace',
          userId: 'user_david',
          clientId: 'client_1',
        },
        parsed.data,
      ),
    ).toBe(true)
    expect(
      canBroadcastPageDocMessage(
        {
          pageId: 'page_deployment',
          userId: 'user_david',
          clientId: 'client_1',
        },
        parsed.data,
      ),
    ).toBe(false)
  })

  it('creates sanitized broadcasts with server metadata', () => {
    const broadcast = createPageDocBroadcast(
      {
        pageId: 'page_private_workspace',
        userId: 'user_david',
        clientId: 'client_1',
      },
      {
        type: 'presence',
        pageId: 'page_private_workspace',
        clientId: 'client_1',
        payload: {},
      },
      '2026-07-06T10:00:00.000Z',
    )

    expect(broadcast).toEqual({
      type: 'presence',
      pageId: 'page_private_workspace',
      clientId: 'client_1',
      payload: {},
      server: {
        userId: 'user_david',
        receivedAt: '2026-07-06T10:00:00.000Z',
      },
    })
  })

  it('rejects malformed socket messages', () => {
    expect(parsePageDocSocketMessage('not json').success).toBe(false)
    expect(
      parsePageDocSocketMessage(
        JSON.stringify({
          type: 'block:update',
          pageId: 'page_private_workspace',
        }),
      ).success,
    ).toBe(false)
  })
})
