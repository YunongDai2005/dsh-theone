// A stand-in iLink server for checking WeChat in a real DSH: long-polled getupdates, sendmessage,
// typing. Point a bound account's baseUrl at it (see weixin.mjs). Control endpoints:
//   POST /control/say  {"text": "...", "from": "..."}  queues a message (from the owner by default)
//   GET  /control/sent                                 messages the bot sent, and every request path
// node fake-ilink-server.mjs [port] [owner]
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 3099)
const owner = process.argv[3] ?? 'owner@im.wechat'
const queue = []
const waiting = []
const sent = []
const paths = []
let nextId = 1

const json = (res, body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const read = req => new Promise(resolve => { let body = ''; req.on('data', chunk => { body += chunk }); req.on('end', () => resolve(body ? JSON.parse(body) : {})) })
const flush = () => { while (queue.length && waiting.length) { const res = waiting.shift(); json(res, { ret: 0, get_updates_buf: `b${nextId}`, msgs: queue.splice(0) }) } }

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  paths.push(url.pathname)
  const body = req.method === 'POST' ? await read(req) : {}
  switch (url.pathname) {
    case '/control/say': {
      const id = nextId++
      queue.push({ message_id: id, from_user_id: body.from ?? owner, message_type: 1, context_token: `ctx-${id}`, item_list: [{ type: 1, text_item: { text: body.text } }] })
      flush()
      return json(res, { queued: id })
    }
    case '/control/sent': return json(res, { sent, paths })
    case '/ilink/bot/getupdates': {
      if (queue.length) return json(res, { ret: 0, get_updates_buf: `b${nextId}`, msgs: queue.splice(0) })
      // Hold like the real server, answering empty after 30 s.
      waiting.push(res)
      const timer = setTimeout(() => { const at = waiting.indexOf(res); if (at >= 0) { waiting.splice(at, 1); json(res, { ret: 0, msgs: [], get_updates_buf: body.get_updates_buf }) } }, 30000)
      res.on('close', () => { clearTimeout(timer); const at = waiting.indexOf(res); if (at >= 0) waiting.splice(at, 1) })
      return
    }
    case '/ilink/bot/sendmessage':
      sent.push({ to: body.msg?.to_user_id, text: body.msg?.item_list?.[0]?.text_item?.text, contextToken: body.msg?.context_token })
      return json(res, { ret: 0 })
    case '/ilink/bot/getconfig': return json(res, { ret: 0, typing_ticket: 'fake-ticket' })
    default: return json(res, { ret: 0 })
  }
}).listen(port, '127.0.0.1', () => console.log(`fake iLink on http://127.0.0.1:${port}, owner ${owner}`))
