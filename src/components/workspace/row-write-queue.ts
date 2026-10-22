// Row writes from this tab are sent one at a time, in the order they were
// made. Row edits and archiving are optimistic (the UI updates before the
// server answers), so without ordering a quick follow-up — dragging a card
// straight back out of Archived, or editing it — can reach the server first
// and then be undone by the earlier write landing after it.

let tail: Promise<unknown> = Promise.resolve()
let pending = 0

/** Queue a row write behind any earlier ones from this tab. */
export function inOrder<T>(write: () => Promise<T>): Promise<T> {
  pending += 1
  const next = tail.then(write, write).finally(() => {
    pending -= 1
  })
  tail = next.catch(() => undefined)
  return next
}

/**
 * True while queued row writes haven't all reached the server. A refetch in
 * that window would return intermediate state and undo optimistic updates,
 * so callers wait for the queue to drain before refetching.
 */
export function hasPendingRowWrites(): boolean {
  return pending > 0
}
