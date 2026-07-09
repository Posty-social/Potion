import { describe, expect, it } from 'vitest'

import {
  canBroadcastPageDocMessage,
  createPageDocBroadcast,
  createPageDocSessionFromHeaders,
  createPresenceState,
  pageDocServerEventSchema,
  parsePageDocSocketMessage,
  viewerFromSession,
} from './messages'

describe('realtime page messages', () => {
  it('creates sessions from forwarded route headers', () => {
    const headers = new Headers({
      'x-potion-page-id': 'page_private_workspace',
      'x-potion-user-id': 'user_david',
      'x-potion-client-id': 'client_1',
      'x-potion-user-name': 'David',
    })

    expect(createPageDocSessionFromHeaders(headers)).toEqual({
      pageId: 'page_private_workspace',
      userId: 'user_david',
      clientId: 'client_1',
      name: 'David',
    })
    expect(createPageDocSessionFromHeaders(new Headers())).toBeNull()
  })

  it('defaults the display name when the header is missing', () => {
    const headers = new Headers({
      'x-potion-page-id': 'page_private_workspace',
      'x-potion-user-id': 'user_david',
      'x-potion-client-id': 'client_1',
    })

    expect(createPageDocSessionFromHeaders(headers)?.name).toBe('Someone')
  })

  it('builds presence state from live sessions', () => {
    const session = {
      pageId: 'page_private_workspace',
      userId: 'user_david',
      clientId: 'client_1',
      name: 'David',
    }

    expect(
      createPresenceState(session.pageId, [viewerFromSession(session)]),
    ).toEqual({
      type: 'presence:state',
      pageId: 'page_private_workspace',
      viewers: [{ clientId: 'client_1', userId: 'user_david', name: 'David' }],
    })
  })

  it('accepts only well-formed server doc:update events', () => {
    expect(
      pageDocServerEventSchema.safeParse({
        type: 'doc:update',
        pageId: 'page_private_workspace',
      }).success,
    ).toBe(true)
    expect(
      pageDocServerEventSchema.safeParse({ type: 'doc:update' }).success,
    ).toBe(false)
    expect(
      pageDocServerEventSchema.safeParse({
        type: 'presence:state',
        pageId: 'page_private_workspace',
      }).success,
    ).toBe(false)
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
          name: 'David',
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
          name: 'David',
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
        name: 'David',
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
