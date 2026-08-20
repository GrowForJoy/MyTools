const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const types = {'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.json':'application/json','.wasm':'application/wasm','.bin':'application/octet-stream','.tflite':'model/tflite'};
http.createServer((q, s) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.normalize(path.join(root, p));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    s.writeHead(404); s.end('404'); return;
  }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(s);
}).listen(8241, () => console.log('static on 8241'));