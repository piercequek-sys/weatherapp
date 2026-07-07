// Minimal static file server for My Travel Pocket App (no dependencies),
// plus a tiny same-origin news proxy so the browser can read Google News RSS.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8778;
const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.map': 'application/json',
};

http.createServer((req, res) => {
  // News proxy: /api/news?url=<google-news-rss-url> — fetched server-side (no CORS/consent issues).
  if (req.url.startsWith('/api/news')) {
    const target = new URL(req.url, 'http://localhost').searchParams.get('url');
    if (!target || !/^https:\/\/news\.google\.com\//.test(target)) {
      res.writeHead(400); res.end('Only news.google.com URLs are allowed'); return;
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 9000);
    fetch(target, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TravelPocket/1.0)' } })
      .then(async (r) => { const body = await r.text(); clearTimeout(timer); res.writeHead(r.ok ? 200 : 502, { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end(body); })
      .catch(() => { clearTimeout(timer); res.writeHead(502); res.end('news fetch failed'); });
    return;
  }

  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Skycast running at http://localhost:${PORT}`));
