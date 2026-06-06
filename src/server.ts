import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import { createPoller } from './poller.ts'
import type { StreamEvent } from './types.ts'
import { activatePane, bringToFront, sendText } from './wezterm.ts'

const PORT = Number(process.env.PORT ?? 6080)
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 1000)

const STATIC_FILES: Record<string, { path: string; type: string }> = {
  '/': { path: 'public/index.html', type: 'text/html; charset=utf-8' },
  '/style.css': { path: 'public/style.css', type: 'text/css' },
  '/app.js': { path: 'public/app.js', type: 'text/javascript' },
  '/app.css': { path: 'public/app.css', type: 'text/css' },
}

const poller = createPoller(POLL_INTERVAL_MS)

const sendEvent = (res: ServerResponse, event: StreamEvent): void => {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

const handleStream = (req: IncomingMessage, res: ServerResponse): void => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  sendEvent(res, poller.fullState())
  const unsubscribe = poller.subscribe((event) => sendEvent(res, event))
  req.on('close', unsubscribe)
}

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString()
}

const handleAction = async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> => {
  const [, , action, idPart] = url.pathname.split('/')
  const paneId = Number(idPart)
  if (!Number.isInteger(paneId)) {
    res.writeHead(400).end('invalid pane id')
    return
  }
  if (action === 'focus') {
    await activatePane(paneId)
    await bringToFront()
  } else if (action === 'send') {
    const { text } = JSON.parse(await readBody(req)) as { text: string }
    await sendText(paneId, text)
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
  poller.start()
  console.log(`cc-mission-control listening on http://localhost:${PORT}`)
})
