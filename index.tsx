import { Hono } from 'hono'

const app = new Hono()

app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() })
})

app.get('/*', (c) => c.text('Veridex'))

const rawPort = parseInt(import.meta.env.PORT ?? '3000', 10)
const port = Number.isFinite(rawPort) && rawPort > 0 && rawPort <= 65535 ? rawPort : 3000

const server = Bun.serve({
  port,
  fetch: app.fetch,
})

console.log(`Veridex listening on http://localhost:${server.port}`)
