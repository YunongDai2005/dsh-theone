import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(import.meta.dirname, 'out');
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript', '.ttf':'font/ttf', '.webp':'image/webp', '.svg':'image/svg+xml', '.xml':'application/xml', '.txt':'text/plain' };
http.createServer(async (req, res) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/\/$/, '/index.html'));
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(path); res.writeHead(200, {'Content-Type':mime[extname(path)] || 'application/octet-stream'}).end(body);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(4173, '127.0.0.1', () => console.log('Local: http://127.0.0.1:4173'));
