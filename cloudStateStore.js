const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');

const FILE_PATH = path.join(__dirname, '.data', 'cloud-state.json');
const DATABASE_URL = process.env.DATABASE_URL;

let pool = null;
let dbReady = false;

function getPool() {
  if (!DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: true },
    });
  }
  return pool;
}

async function ensureDb() {
  const activePool = getPool();
  if (!activePool || dbReady) return activePool;
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  dbReady = true;
  return activePool;
}

async function readFileStore() {
  try {
    const raw = await fs.readFile(FILE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    if (error instanceof SyntaxError) {
      console.warn('Estado local cloud corrupto; se reiniciará al guardar de nuevo.');
      return {};
    }
    throw error;
  }
}

async function writeFileStore(data) {
  await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2));
}

function validarKey(key) {
  if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(key)) {
    const error = new Error('Clave de estado inválida');
    error.statusCode = 400;
    throw error;
  }
}

async function listar() {
  const activePool = await ensureDb();
  if (activePool) {
    const result = await activePool.query('SELECT key, value, updated_at FROM app_state');
    return Object.fromEntries(result.rows.map(row => [
      row.key,
      { value: row.value, updatedAt: row.updated_at },
    ]));
  }

  return readFileStore();
}

async function obtener(key) {
  validarKey(key);
  const activePool = await ensureDb();
  if (activePool) {
    const result = await activePool.query(
      'SELECT value, updated_at FROM app_state WHERE key = $1',
      [key],
    );
    if (!result.rows.length) return null;
    return {
      value: result.rows[0].value,
      updatedAt: result.rows[0].updated_at,
    };
  }

  const data = await readFileStore();
  return data[key] || null;
}

async function guardar(key, value) {
  validarKey(key);
  const activePool = await ensureDb();
  if (activePool) {
    const result = await activePool.query(`
      INSERT INTO app_state (key, value, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      RETURNING updated_at
    `, [key, JSON.stringify(value)]);
    return { value, updatedAt: result.rows[0].updated_at };
  }

  const data = await readFileStore();
  data[key] = { value, updatedAt: new Date().toISOString() };
  await writeFileStore(data);
  return data[key];
}

async function eliminar(key) {
  validarKey(key);
  const activePool = await ensureDb();
  if (activePool) {
    await activePool.query('DELETE FROM app_state WHERE key = $1', [key]);
    return;
  }

  const data = await readFileStore();
  delete data[key];
  await writeFileStore(data);
}

module.exports = {
  listar,
  obtener,
  guardar,
  eliminar,
};
