const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const cloudStateStore = require('./cloudStateStore');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const TOKEN = process.env.DERIV_TOKEN;
const APP_ID = process.env.DERIV_APP_ID;
const ACCOUNT_ID = process.env.DERIV_ACCOUNT_ID;
const DEMO_TOKEN = process.env.DERIV_DEMO_TOKEN || TOKEN;
const DEMO_ACCOUNT_ID = process.env.DERIV_DEMO_ACCOUNT_ID || ACCOUNT_ID;
const REAL_TOKEN = process.env.DERIV_REAL_TOKEN;
const REAL_ACCOUNT_ID = process.env.DERIV_REAL_ACCOUNT_ID;
const APP_USERNAME = process.env.APP_USERNAME;
const APP_PASSWORD = process.env.APP_PASSWORD;
const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const MICROSOFT_TENANT_ID = process.env.MICROSOFT_TENANT_ID;
const MICROSOFT_REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI;
const MICROSOFT_ALLOWED_EMAILS = (process.env.MICROSOFT_ALLOWED_EMAILS || '')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(Boolean);
const SESSION_SECRET = process.env.SESSION_SECRET;
const MICROSOFT_AUTH_ENABLED = Boolean(
  MICROSOFT_CLIENT_ID && MICROSOFT_CLIENT_SECRET && MICROSOFT_TENANT_ID && SESSION_SECRET,
);
const INDEX_PATH = path.join(__dirname, 'index.html');
const CHARTS_PATH = path.join(
  __dirname,
  'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js',
);
const PUBLIC_JS_ROOTS = ['components', 'services', 'trading'];
const SESSION_COOKIE = 'cbm_session';
const STATE_COOKIE = 'cbm_ms_state';
const NONCE_COOKIE = 'cbm_ms_nonce';

// ── Seguridad: headers HTTP ──────────────────────────────────────────────────
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "connect-src 'self' wss://*.derivws.com",
  "img-src 'self' data:",
  "frame-ancestors 'none'",
].join('; ');

function aplicarHeadersSeguridad(res) {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', CSP);
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
}

// ── Seguridad: rate limiting en memoria (60 req/min por IP) ─────────────────
const rateLimitStore = new Map();
const RATE_LIMIT_VENTANA_MS = 60_000;
const RATE_LIMIT_MAX = 60;

// Limpiar IPs antiguas cada 5 minutos para evitar crecimiento indefinido.
setInterval(() => {
  const ahora = Date.now();
  for (const [ip, entrada] of rateLimitStore.entries()) {
    if (ahora - entrada.inicio > RATE_LIMIT_VENTANA_MS * 2) rateLimitStore.delete(ip);
  }
}, 5 * 60_000);

function superaRateLimit(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const ahora = Date.now();
  const entrada = rateLimitStore.get(ip) || { count: 0, inicio: ahora };
  if (ahora - entrada.inicio > RATE_LIMIT_VENTANA_MS) {
    rateLimitStore.set(ip, { count: 1, inicio: ahora });
    return false;
  }
  entrada.count++;
  rateLimitStore.set(ip, entrada);
  return entrada.count > RATE_LIMIT_MAX;
}

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
  aplicarHeadersSeguridad(res);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').map(item => {
    const [key, ...rest] = item.trim().split('=');
    return [key, decodeURIComponent(rest.join('=') || '')];
  }).filter(([key]) => key));
}

function cookieOptions({ maxAge = 3600, httpOnly = true } = {}) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `Path=/; Max-Age=${maxAge}; SameSite=Strict${secure}${httpOnly ? '; HttpOnly' : ''}`;
}

function setCookie(res, name, value, options = {}) {
  const cookie = `${name}=${encodeURIComponent(value)}; ${cookieOptions(options)}`;
  const previous = res.getHeader?.('Set-Cookie');
  if (!previous) {
    res.setHeader('Set-Cookie', cookie);
  } else {
    res.setHeader('Set-Cookie', Array.isArray(previous) ? [...previous, cookie] : [previous, cookie]);
  }
}

function clearCookie(res, name) {
  setCookie(res, name, '', { maxAge: 0 });
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function base64urlJson(value) {
  return base64url(JSON.stringify(value));
}

function parseBase64urlJson(value) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
}

function firmar(payload) {
  return base64url(crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest());
}

function crearSesion(usuario) {
  const payload = base64urlJson({
    ...usuario,
    exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60,
  });
  return `${payload}.${firmar(payload)}`;
}

function leerSesion(req) {
  if (!MICROSOFT_AUTH_ENABLED) return null;
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expected = firmar(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length
    || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) return null;
  const session = parseBase64urlJson(payload);
  if (!session.exp || session.exp < Math.floor(Date.now() / 1000)) return null;
  return session;
}

function origenPublico(req) {
  const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${req.headers.host || `localhost:${PORT}`}`;
}

function redirectUri(req) {
  return MICROSOFT_REDIRECT_URI || `${origenPublico(req)}/auth/microsoft/callback`;
}

function basicAutenticado(req) {
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

function autenticado(req) {
  return Boolean(leerSesion(req)) || basicAutenticado(req);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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

function enviarLogin(res, mensaje = '') {
  const mensajeSeguro = escapeHtml(mensaje);
  const microsoftButton = MICROSOFT_AUTH_ENABLED
    ? '<a class="btn" href="/auth/microsoft">Iniciar sesión con Microsoft</a>'
    : '<div class="note warn">Microsoft SSO no está configurado todavía. Revisa las variables de entorno en Render.</div>';
  const basicButton = APP_USERNAME && APP_PASSWORD
    ? '<a class="link" href="/auth/basic">Usar acceso básico temporal</a>'
    : '';
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CBM Trading · Login</title>
  <style>
    * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #131722; color: #d1d4dc; padding: 20px; }
    .card { width: min(420px, 100%); background: #1e222d; border: 1px solid #2a2e39; border-radius: 18px; padding: 28px; box-shadow: 0 20px 70px rgba(0,0,0,.32); }
    h1 { margin: 0 0 8px; font-size: 24px; }
    p { margin: 0 0 22px; color: #9598a1; line-height: 1.45; }
    .btn { display: block; width: 100%; text-align: center; text-decoration: none; background: #2962ff; color: white; border-radius: 10px; padding: 13px 16px; font-weight: 700; }
    .btn:hover { background: #1e4fd6; }
    .link { display: block; text-align: center; margin-top: 16px; color: #26a69a; text-decoration: none; font-size: 13px; }
    .note { margin: 0 0 16px; padding: 10px 12px; border-radius: 10px; background: rgba(239,83,80,.12); border: 1px solid rgba(239,83,80,.35); color: #ffb4b4; font-size: 13px; }
    .warn { color: #f6c56f; background: rgba(214,128,0,.12); border-color: rgba(214,128,0,.35); }
  </style>
</head>
<body>
  <main class="card">
    <h1>CBM Trading</h1>
    <p>Accede de forma segura para operar tu panel.</p>
    ${mensajeSeguro ? `<div class="note">${mensajeSeguro}</div>` : ''}
    ${microsoftButton}
    ${basicButton}
  </main>
</body>
</html>`);
}

function enviarSesionCerrada(res) {
  const microsoftButton = MICROSOFT_AUTH_ENABLED
    ? '<a class="btn" href="/auth/microsoft">Iniciar sesión con Microsoft</a>'
    : '<a class="btn" href="/login">Volver al inicio de sesión</a>';
  const basicHelp = APP_USERNAME && APP_PASSWORD
    ? '<p class="small">Si el navegador vuelve a entrar automáticamente, es porque conserva el acceso básico temporal. Usa Microsoft SSO o cierra la ventana para limpiar ese acceso del navegador.</p>'
    : '';
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CBM Trading · Sesión cerrada</title>
  <style>
    * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #131722; color: #d1d4dc; padding: 20px; }
    .card { width: min(420px, 100%); background: #1e222d; border: 1px solid #2a2e39; border-radius: 18px; padding: 28px; box-shadow: 0 20px 70px rgba(0,0,0,.32); }
    h1 { margin: 0 0 8px; font-size: 24px; }
    p { margin: 0 0 22px; color: #9598a1; line-height: 1.45; }
    .btn { display: block; width: 100%; text-align: center; text-decoration: none; background: #2962ff; color: white; border-radius: 10px; padding: 13px 16px; font-weight: 700; }
    .btn:hover { background: #1e4fd6; }
    .small { margin-top: 16px; margin-bottom: 0; font-size: 12px; }
  </style>
</head>
<body>
  <main class="card">
    <h1>Sesión cerrada</h1>
    <p>Tu sesión de CBM Trading se cerró correctamente en este navegador.</p>
    ${microsoftButton}
    ${basicHelp}
  </main>
</body>
</html>`);
}

function redirigir(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function tokenAleatorio() {
  return base64url(crypto.randomBytes(32));
}

async function iniciarMicrosoft(req, res) {
  if (!MICROSOFT_AUTH_ENABLED) {
    enviarLogin(res, 'Microsoft SSO no está configurado completo en el servidor.');
    return;
  }
  const state = tokenAleatorio();
  const nonce = tokenAleatorio();
  setCookie(res, STATE_COOKIE, state, { maxAge: 600 });
  setCookie(res, NONCE_COOKIE, nonce, { maxAge: 600 });
  const params = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(req),
    response_mode: 'query',
    scope: 'openid profile email',
    state,
    nonce,
    prompt: 'select_account',
  });
  redirigir(res, `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize?${params}`);
}

async function finalizarMicrosoft(req, res) {
  if (!MICROSOFT_AUTH_ENABLED) {
    enviarLogin(res, 'Microsoft SSO no está configurado completo en el servidor.');
    return;
  }
  const url = new URL(req.url, origenPublico(req));
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error_description') || url.searchParams.get('error');
  const cookies = parseCookies(req);

  if (error) {
    enviarLogin(res, `Microsoft rechazó el inicio de sesión: ${error}`);
    return;
  }
  if (!code || !state || state !== cookies[STATE_COOKIE]) {
    enviarLogin(res, 'No se pudo validar la respuesta de Microsoft. Intenta iniciar sesión de nuevo.');
    return;
  }

  const body = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID,
    client_secret: MICROSOFT_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(req),
    scope: 'openid profile email',
  });
  const response = await fetch(`https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await response.json();
  if (!response.ok || !data.id_token) {
    enviarLogin(res, data.error_description || 'Microsoft no devolvió una sesión válida.');
    return;
  }

  const [, payload] = data.id_token.split('.');
  const claims = parseBase64urlJson(payload);
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== MICROSOFT_CLIENT_ID || claims.exp < now || claims.nonce !== cookies[NONCE_COOKIE]) {
    enviarLogin(res, 'La sesión de Microsoft no pasó la validación de seguridad.');
    return;
  }

  const email = String(claims.preferred_username || claims.email || claims.upn || '').toLowerCase();
  if (MICROSOFT_ALLOWED_EMAILS.length && !MICROSOFT_ALLOWED_EMAILS.includes(email)) {
    enviarLogin(res, 'Tu cuenta Microsoft no está autorizada para entrar a esta app.');
    return;
  }

  setCookie(res, SESSION_COOKIE, crearSesion({
    email,
    name: claims.name || email || 'Usuario Microsoft',
  }), { maxAge: 8 * 60 * 60 });
  clearCookie(res, STATE_COOKIE);
  clearCookie(res, NONCE_COOKIE);
  redirigir(res, '/');
}

function cerrarSesion(res) {
  clearCookie(res, SESSION_COOKIE);
  clearCookie(res, STATE_COOKIE);
  clearCookie(res, NONCE_COOKIE);
  enviarSesionCerrada(res);
}

function obtenerCredencialesDeriv(modo = 'demo') {
  const real = modo === 'real';
  return {
    token: real ? REAL_TOKEN : DEMO_TOKEN,
    accountId: normalizarAccountId(real ? REAL_ACCOUNT_ID : DEMO_ACCOUNT_ID),
    modo: real ? 'real' : 'demo',
  };
}

function normalizarAccountId(accountId) {
  return String(accountId || '').trim().toUpperCase();
}

function accountTypeMatches(account, modo) {
  const type = String(account.account_type || '').toLowerCase();
  const id = normalizarAccountId(account.account_id);
  if (modo === 'real') return type === 'real' || id.startsWith('CR');
  return type === 'demo' || type === 'virtual' || id.startsWith('VRTC');
}

async function resolverCuentaDeriv(credenciales) {
  const data = await derivFetch('https://api.derivws.com/trading/v1/options/accounts', {
    token: credenciales.token,
  });
  const accounts = Array.isArray(data.data) ? data.data : [];
  const exacta = accounts.find(item => (
    normalizarAccountId(item.account_id) === credenciales.accountId
  ));

  if (credenciales.modo === 'real') {
    if (!exacta) {
      const error = new Error(
        `Ninguna cuenta del token coincide exactamente con DERIV_REAL_ACCOUNT_ID (${credenciales.accountId}). `
        + 'Por seguridad no se elige otra cuenta automáticamente en modo real.',
      );
      error.statusCode = 404;
      throw error;
    }
    if (!accountTypeMatches(exacta, 'real')) {
      const error = new Error(
        `La cuenta configurada en DERIV_REAL_ACCOUNT_ID (${credenciales.accountId}) no es una cuenta real.`,
      );
      error.statusCode = 400;
      throw error;
    }
    return exacta;
  }

  const account = exacta || accounts.find(item => accountTypeMatches(item, credenciales.modo));

  if (!account) {
    const error = new Error(`No se encontró una cuenta ${credenciales.modo} disponible para este token`);
    error.statusCode = 404;
    throw error;
  }

  return account;
}

async function derivFetch(url, options = {}) {
  const { token = TOKEN, ...fetchOptions } = options;
  if (!token || !APP_ID) {
    const error = new Error('Faltan token de Deriv o DERIV_APP_ID en .env');
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch(url, {
    ...fetchOptions,
    headers: {
      Authorization: `Bearer ${token}`,
      'Deriv-App-ID': APP_ID,
      ...fetchOptions.headers,
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
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const cuentaSolicitada = parsedUrl.searchParams.get('account') === 'real' ? 'real' : 'demo';

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

  if (parsedUrl.pathname === '/api/account') {
    const credenciales = obtenerCredencialesDeriv(cuentaSolicitada);
    if (!credenciales.accountId) {
      sendJson(res, 500, { error: `Falta DERIV_${cuentaSolicitada.toUpperCase()}_ACCOUNT_ID en las variables de entorno` });
      return;
    }
    const account = await resolverCuentaDeriv(credenciales);

    sendJson(res, 200, {
      accountId: account.account_id,
      balance: account.balance,
      currency: account.currency,
      accountType: account.account_type,
      mode: cuentaSolicitada,
    });
    return;
  }

  if (parsedUrl.pathname === '/api/ws-url') {
    const credenciales = obtenerCredencialesDeriv(cuentaSolicitada);
    if (!credenciales.accountId) {
      sendJson(res, 500, { error: `Falta DERIV_${cuentaSolicitada.toUpperCase()}_ACCOUNT_ID en las variables de entorno` });
      return;
    }
    const account = await resolverCuentaDeriv(credenciales);
    const data = await derivFetch(
      `https://api.derivws.com/trading/v1/options/accounts/${account.account_id}/otp`,
      { method: 'POST', token: credenciales.token },
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

    const parsedPath = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
    if (req.method === 'GET' && parsedPath === '/login') {
      if (autenticado(req)) {
        redirigir(res, '/');
      } else {
        enviarLogin(res);
      }
      return;
    }
    if (req.method === 'GET' && parsedPath === '/auth/microsoft') {
      await iniciarMicrosoft(req, res);
      return;
    }
    if (req.method === 'GET' && parsedPath === '/auth/microsoft/callback') {
      await finalizarMicrosoft(req, res);
      return;
    }
    if (req.method === 'GET' && parsedPath === '/auth/basic') {
      solicitarAutenticacion(res);
      return;
    }
    if (req.method === 'GET' && parsedPath === '/logout') {
      cerrarSesion(res);
      return;
    }

    if (!autenticado(req)) {
      if (MICROSOFT_AUTH_ENABLED && req.method === 'GET' && (parsedPath === '/' || parsedPath === '/index.html')) {
        enviarLogin(res);
      } else {
        solicitarAutenticacion(res);
      }
      return;
    }

    if (req.url?.startsWith('/api/')) {
      if (superaRateLimit(req)) {
        sendJson(res, 429, { error: 'Demasiadas solicitudes. Intenta en un momento.' });
        return;
      }
      await handleApi(req, res);
      return;
    }

    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const html = await fs.readFile(INDEX_PATH);
      aplicarHeadersSeguridad(res);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && req.url === '/vendor/lightweight-charts.js') {
      const script = await fs.readFile(CHARTS_PATH);
      aplicarHeadersSeguridad(res);
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
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
        aplicarHeadersSeguridad(res);
        res.writeHead(200, {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Cache-Control': 'no-store',
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
