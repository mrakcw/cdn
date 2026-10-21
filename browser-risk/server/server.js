// Browser Risk Assessment — серверный обработчик HTTP-заголовков (Node.js 18+, без зависимостей).
//
//   node cdn/server/server.js [--port 8787] [--host 127.0.0.1] [--save-dir cdn/examples]
//
// • GET /, /index.html — страница диагностики; в неё подставляются заголовки ЭТОГО перехода (navigate).
// • GET /api/headers   — заголовки запроса fetch (CORS), для страницы, размещённой на другом адресе.
// • POST /api/report?label=… — сохранить отчёт в --save-dir (только если каталог задан при запуске).
// • Остальные файлы cdn/ — как статика.
//
// Собираются только заголовки из списка ниже. Cookie, Authorization и IP-адрес не читаются и не сохраняются.
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const cdnRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SERVER_HEADERS = [
  'user-agent', 'accept-language', 'sec-ch-ua', 'sec-ch-ua-platform', 'sec-ch-ua-mobile',
  'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'accept', 'accept-encoding',
];

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export function pickHeaders(requestHeaders) {
  const picked = {};
  for (const name of SERVER_HEADERS) {
    const value = requestHeaders[name];
    if (value !== undefined) picked[name] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return picked;
}

function escapeForScript(json) {
  return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  });
  response.end(body);
}

export function createRiskServer({ root = cdnRoot, saveDir = null } = {}) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const origin = request.headers.origin;
      const cors = origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};

      if (url.pathname === '/api/headers') {
        if (request.method === 'OPTIONS') return send(response, 204, '', { ...cors, 'access-control-allow-methods': 'GET' });
        const body = JSON.stringify({ source: 'fetch', receivedAt: new Date().toISOString(), headers: pickHeaders(request.headers) });
        return send(response, 200, body, { ...cors, 'content-type': contentTypes['.json'] });
      }

      if (url.pathname === '/api/report' && request.method === 'POST') {
        if (!saveDir) return send(response, 403, 'Saving is disabled: start the server with --save-dir.');
        const label = (url.searchParams.get('label') || 'report').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'report';
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 1024 * 1024) return send(response, 413, 'Report is too large.');
          chunks.push(chunk);
        }
        const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        await mkdir(saveDir, { recursive: true });
        const file = path.join(saveDir, `report-${label}.json`);
        await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        return send(response, 200, JSON.stringify({ saved: path.basename(file) }), { 'content-type': contentTypes['.json'] });
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, 'Method not allowed.');

      const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep) || file.includes(`${path.sep}server${path.sep}`)) return send(response, 404, 'Not found.');
      let body = await readFile(file).catch(() => null);
      if (!body) return send(response, 404, 'Not found.');

      if (path.basename(file) === 'index.html') {
        // Заголовки именно этого перехода на страницу — самый достоверный server-side источник.
        const payload = escapeForScript(JSON.stringify({ source: 'navigation', receivedAt: new Date().toISOString(), headers: pickHeaders(request.headers) }));
        body = Buffer.from(body.toString('utf8').replace(
          '<!--SERVER_HEADERS-->',
          `<script type="application/json" id="server-headers">${payload}</script>`
            + `<meta name="browser-risk-server" content="${saveDir ? 'save' : 'on'}">`,
        ), 'utf8');
      }
      return send(response, 200, body, { 'content-type': contentTypes[path.extname(file)] || 'application/octet-stream' });
    } catch (error) {
      return send(response, 500, `Server error: ${error.message}`);
    }
  });
}

// Запуск из командной строки.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };
  const port = Number(option('port', 8787));
  const host = option('host', '127.0.0.1');
  const saveDir = option('save-dir', null);
  createRiskServer({ saveDir: saveDir ? path.resolve(saveDir) : null }).listen(port, host, () => {
    console.log(`Browser Risk Assessment: http://${host}:${port}/${saveDir ? ` (отчёты сохраняются в ${saveDir})` : ''}`);
  });
}
