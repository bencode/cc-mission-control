import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import { createPoller } from './poller.ts'
import type { StreamEvent } from './types.ts'
import {
  activatePane,
  bringToFront,
  clearFocusRequest,
  killPane,
  sendText,
  writeFocusRequest,
} from './wezterm.ts'

const PORT = Number(process.env.PORT ?? 6080)
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 1000)

const STATIC_FILES: Record<string, { path: string; type: string }> = {
  '/': { path: 'public/index.html', type: 'text/html; charset=utf-8' },
  '/style.css': { path: 'public/style.css', type: 'text/css' },
  '/app.js': { path: 'public/app.js', type: 'text/javascript' },
  '/app.css': { path: 'public/app.css', type: 'text/css' },
}

const poller = createPoller(POLL_INTERVAL_MS)

/** Named heartbeat so the client can tell a live-but-quiet stream from a dead one. */
const HEARTBEAT_MS = 10_000

const sendEvent = (res: ServerResponse, event: StreamEvent): void => {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

/** Poll only while someone is watching; pane states survive across pauses. */
let clientCount = 0

const handleStream = (req: IncomingMessage, res: ServerResponse): void => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  clientCount += 1
  poller.start()
  sendEvent(res, poller.fullState())
  const unsubscribe = poller.subscribe((event) => sendEvent(res, event))
  const heartbeat = setInterval(() => res.write('event: ping\ndata: 1\n\n'), HEARTBEAT_MS)
  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
    clientCount -= 1
    if (clientCount === 0) poller.stop()
  })
}

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString()
}

/** Run one focus step, logging a rejection instead of letting it abort the others.
    Focus is best-effort: a stale pane id (closed since the last poll) or a busy GUI
    can reject one step, but the cross-workspace handoff and bring-to-front should
    still run. */
const runFocusStep = async (label: string, task: Promise<unknown>): Promise<void> => {
  try {
    await task
  } catch (error) {
    console.warn(`focus step ${label} failed:`, error)
  }
}

const handleAction = async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> => {
  const [, , action, idPart] = url.pathname.split('/')
  const paneId = Number(idPart)
  if (!Number.isInteger(paneId)) {
    res.writeHead(400).end('invalid pane id')
    return
  }
  if (action === 'focus') {
    // Run the three steps in parallel (total = max, not sum) and tolerate a single
    // step failing — a stale pane id or a busy GUI must not abort the cross-workspace
    // handoff or bring-to-front. runFocusStep logs the failure rather than swallowing it.
    await Promise.all([
      runFocusStep('activate-pane', activatePane(paneId)), // instant within the active workspace
      runFocusStep('focus-request', writeFocusRequest(paneId)), // Lua bridge handles cross-workspace jumps
      runFocusStep('bring-to-front', bringToFront()),
    ])
  } else if (action === 'send') {
    const { text } = JSON.parse(await readBody(req)) as { text: string }
    await sendText(paneId, text)
  } else if (action === 'close') {
    await killPane(paneId)
  } else {
    res.writeHead(404).end()
    return
  }
  res.writeHead(204).end()
}

const handleStatic = async (res: ServerResponse, pathname: string): Promise<void> => {
  const file = STATIC_FILES[pathname]
  if (!file) {
    res.writeHead(404).end()
    return
  }
  // no-cache = revalidate before reuse; keeps long-lived tabs from running stale bundles
  res.writeHead(200, { 'content-type': file.type, 'cache-control': 'no-cache' })
  res.end(await readFile(new URL(`../${file.path}`, import.meta.url)))
}

const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  if (url.pathname === '/api/stream') return handleStream(req, res)
  if (req.method === 'POST' && url.pathname.startsWith('/api/')) return handleAction(req, res, url)
  return handleStatic(res, url.pathname)
}

createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(`${req.method} ${req.url} failed:`, error)
    if (!res.headersSent) res.writeHead(500)
    res.end()
  })
}).listen(PORT, () => {
  void clearFocusRequest()
  console.log(`cc-mission-control listening on http://localhost:${PORT}`)
})
