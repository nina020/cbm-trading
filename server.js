const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const cloudStateStore = require('./cloudStateStore');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const TOKEN = process.env.DERIV_TOKEN;
const APP_ID = process.env.DERIV_APP_ID;
const ACCOUNT_ID = process.env.DERIV_ACCOUNT_ID;
const APP_USERNAME = process.env.APP_USERNAME;
const APP_PASSWORD = process.env.APP_PASSWORD;
const INDEX_PATH = path.join(__dirname, 'index.html');
const CHARTS_PATH = path.join(
  __dirname,
  'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js',
);
const PUBLIC_JS_ROOTS = ['components', 'services', 'trading'];

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('JSON inválido');
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function autenticado(req) {
  if (!APP_USERNAME || !APP_PASSWORD) return process.env.NODE_ENV !== 'production';
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Basic ')) return false;

  try {
    const credenciales = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const separador = credenciales.indexOf(':');
    if (separador < 0) return false;
    const usuario = credenciales.slice(0, separador);
    const password = credenciales.slice(separador + 1);
    return usuario === APP_USERNAME && password === APP_PASSWORD;
  } catch {
    return false;
  }
}

function solicitarAutenticacion(res) {
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="CBM Trading", charset="UTF-8"',
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end('Autenticación requerida');
}

async function derivFetch(url, options = {}) {
  if (!TOKEN || !APP_ID) {
    const error = new Error('Faltan DERIV_TOKEN o DERIV_APP_ID en .env');
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Deriv-App-ID': APP_ID,
      ...options.headers,
    },
  });
  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data?.errors?.[0]?.message || 'Deriv rechazó la solicitud');
    error.statusCode = response.status;
    throw error;
  }

  return data;
}

async function handleApi(req, res) {
  if (req.url === '/api/state' && req.method === 'GET') {
    sendJson(res, 200, { items: await cloudStateStore.listar() });
    return;
  }

  if (req.url?.startsWith('/api/state/')) {
    const key = decodeURIComponent(req.url.slice('/api/state/'.length));
    if (req.method === 'GET') {
      const item = await cloudStateStore.obtener(key);
      if (!item) {
        sendJson(res, 404, { error: 'Estado no encontrado' });
        return;
      }
      sendJson(res, 200, item);
      return;
    }
    if (req.method === 'PUT') {
      const body = await readJson(req);
      const item = await cloudStateStore.guardar(key, body.value);
      sendJson(res, 200, item);
      return;
    }
    if (req.method === 'DELETE') {
      await cloudStateStore.eliminar(key);
      sendJson(res, 200, { ok: true });
      return;
    }
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Método no permitido' });
    return;
  }

  if (req.url === '/api/account') {
    if (!ACCOUNT_ID) {
      sendJson(res, 500, { error: 'Falta DERIV_ACCOUNT_ID en las variables de entorno' });
      return;
    }
    const data = await derivFetch('https://api.derivws.com/trading/v1/options/accounts');
    const accounts = Array.isArray(data.data) ? data.data : [];
    const account = accounts.find(item => item.account_id === ACCOUNT_ID)
      || accounts.find(item => item.account_type === 'demo');

    if (!account) {
      sendJson(res, 404, { error: 'No se encontró una cuenta demo' });
      return;
    }

    sendJson(res, 200, {
      accountId: account.account_id,
      balance: account.balance,
      currency: account.currency,
      accountType: account.account_type,
    });
    return;
  }

  if (req.url === '/api/ws-url') {
    if (!ACCOUNT_ID) {
      sendJson(res, 500, { error: 'Falta DERIV_ACCOUNT_ID en las variables de entorno' });
      return;
    }
    const data = await derivFetch(
      `https://api.derivws.com/trading/v1/options/accounts/${ACCOUNT_ID}/otp`,
      { method: 'POST' },
    );

    if (!data.data?.url) {
      sendJson(res, 502, { error: 'Deriv no devolvió una sesión WebSocket' });
      return;
    }

    sendJson(res, 200, { url: data.data.url });
    return;
  }

  sendJson(res, 404, { error: 'Ruta no encontrada' });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (!autenticado(req)) {
      solicitarAutenticacion(res);
      return;
    }

    if (req.url?.startsWith('/api/')) {
      await handleApi(req, res);
      return;
    }

    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const html = await fs.readFile(INDEX_PATH);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && req.url === '/vendor/lightweight-charts.js') {
      const script = await fs.readFile(CHARTS_PATH);
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(script);
      return;
    }

    if (req.method === 'GET' && req.url?.endsWith('.js')) {
      const relativePath = decodeURIComponent(req.url.slice(1));
      const topLevel = relativePath.split('/')[0];
      const allowed = relativePath === 'app.js'
        || relativePath === 'config.js'
        || relativePath === 'state.js'
        || PUBLIC_JS_ROOTS.includes(topLevel);

      if (allowed && !relativePath.includes('..')) {
        const scriptPath = path.join(__dirname, relativePath);
        const script = await fs.readFile(scriptPath);
        res.writeHead(200, {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(script);
        return;
      }
    }

    sendJson(res, 404, { error: 'Ruta no encontrada' });
  } catch (error) {
    console.error(error);
    sendJson(res, error.statusCode || 500, {
      error: error.statusCode ? error.message : 'Error interno del servidor',
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`CBM Trading disponible en http://${HOST}:${PORT}`);
});
