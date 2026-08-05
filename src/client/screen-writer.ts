import type { Terminal } from '@xterm/xterm'

/**
 * xterm's write queue is setTimeout-driven, which background tabs throttle to
 * about one wake per minute — queued screens then parse in one long freeze.
 * Every write here is a full-screen snapshot, so only the newest matters:
 * keep at most one write in flight plus one pending, and the queue stays
 * bounded no matter how fast updates arrive.
 */
export type ScreenWriter = {
  write: (text: string) => void
  /** Drop bookkeeping for a disposed terminal; its write callback never fires. */
  reset: () => void
}

export const createScreenWriter = (getTerminal: () => Terminal | null): ScreenWriter => {
  let pending: string | null = null
  let inFlight = false

  const flush = (text: string): void => {
    const terminal = getTerminal()
    if (!terminal) return
    inFlight = true
    terminal.reset()
    terminal.write(text.replace(/(?:\r?\n)+$/, ''), () => {
      inFlight = false
      const next = pending
      pending = null
      if (next !== null) flush(next)
    })
  }

  return {
    write: (text) => {
      if (inFlight) {
        pending = text
        return
      }
      flush(text)
    },
    reset: () => {
      inFlight = false
      pending = null
    },
  }
}
