// Small HTTP helpers shared by the Instagram and YouTube clients.

import { open } from 'node:fs/promises'

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly opts: {
      status?: number
      retriable: boolean
      /** Ask the user to reconnect the account. */
      authError?: boolean
      /** Earliest time a retry makes sense, e.g. after a quota reset. */
      retryAfter?: Date
      code?: string | number
      raw?: unknown
    }
  ) {
    super(message)
    this.name = 'ApiError'
  }
  get retriable(): boolean {
    return this.opts.retriable
  }
}

export async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 60_000, ...rest } = init
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...rest, signal: ctrl.signal })
  } catch (err) {
    const msg = (err as Error)?.name === 'AbortError' ? 'The request timed out.' : `Network error: ${(err as Error)?.message ?? err}`
    throw new ApiError(msg, { retriable: true })
  } finally {
    clearTimeout(timer)
  }
}

export async function readJson(res: Response): Promise<any> {
  const text = await res.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { _text: text.slice(0, 500) }
  }
}

/**
 * Streams a byte range of a file as an async iterable, reporting progress.
 * Using an iterable (with duplex: 'half') keeps memory flat for large videos.
 */
export function fileBody(
  filePath: string,
  start: number,
  end: number, // exclusive
  onBytes?: (sent: number) => void,
  chunkSize = 1024 * 1024
): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      const fh = await open(filePath, 'r')
      try {
        let pos = start
        let sent = 0
        while (pos < end) {
          const len = Math.min(chunkSize, end - pos)
          const buf = Buffer.alloc(len)
          const { bytesRead } = await fh.read(buf, 0, len, pos)
          if (bytesRead <= 0) throw new Error('The video file ended unexpectedly. Was it changed or moved?')
          pos += bytesRead
          sent += bytesRead
          yield bytesRead === len ? buf : buf.subarray(0, bytesRead)
          onBytes?.(sent)
        }
      } finally {
        await fh.close()
      }
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
