import { describe, expect, it } from 'vitest'

import { hasPendingRowWrites, inOrder } from './row-write-queue'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('row write queue', () => {
  it('sends writes one at a time, in order, even if earlier ones are slower', async () => {
    const log: string[] = []
    const write = (name: string, ms: number) => async () => {
      log.push(`start ${name}`)
      await delay(ms)
      log.push(`end ${name}`)
      return name
    }

    const archive = inOrder(write('archive', 30))
    const unarchive = inOrder(write('unarchive', 1))
    const move = inOrder(write('move', 1))
    expect(hasPendingRowWrites()).toBe(true)

    expect(await Promise.all([archive, unarchive, move])).toEqual([
      'archive',
      'unarchive',
      'move',
    ])
    expect(log).toEqual([
      'start archive',
      'end archive',
      'start unarchive',
      'end unarchive',
      'start move',
      'end move',
    ])
    expect(hasPendingRowWrites()).toBe(false)
  })

  it('keeps going after a failed write and still reports the failure', async () => {
    const failed = inOrder(async () => {
      throw new Error('server said no')
    })
    const next = inOrder(async () => 'ok')

    await expect(failed).rejects.toThrow('server said no')
    expect(await next).toBe('ok')
    expect(hasPendingRowWrites()).toBe(false)
  })
})
