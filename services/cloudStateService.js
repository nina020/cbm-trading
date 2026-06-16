const SINCRONIZAR = new Set();
let sincronizando = false;
let listo = false;

function parseValor(raw) {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function escribirLocal(key, value) {
  sincronizando = true;
  try {
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } finally {
    sincronizando = false;
  }
}

async function enviar(key, value) {
  if (!listo || !SINCRONIZAR.has(key) || sincronizando) return;
  try {
    await fetch(`/api/state/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
  } catch (error) {
    console.warn(`No se pudo sincronizar ${key}:`, error);
  }
}

async function eliminarRemoto(key) {
  if (!listo || !SINCRONIZAR.has(key) || sincronizando) return;
  try {
    await fetch(`/api/state/${encodeURIComponent(key)}`, { method: 'DELETE' });
  } catch (error) {
    console.warn(`No se pudo eliminar ${key} en la nube:`, error);
  }
}

function interceptarLocalStorage() {
  const originalSetItem = localStorage.setItem.bind(localStorage);
  const originalRemoveItem = localStorage.removeItem.bind(localStorage);

  localStorage.setItem = (key, value) => {
    originalSetItem(key, value);
    enviar(key, parseValor(value));
  };

  localStorage.removeItem = key => {
    originalRemoveItem(key);
    eliminarRemoto(key);
  };
}

export async function iniciarSincronizacionCloud(keys) {
  keys.forEach(key => SINCRONIZAR.add(key));

  try {
    const response = await fetch('/api/state');
    if (response.ok) {
      const data = await response.json();
      Object.entries(data.items || {}).forEach(([key, entry]) => {
        if (SINCRONIZAR.has(key)) escribirLocal(key, entry.value);
      });
    }
  } catch (error) {
    console.warn('No se pudo cargar la sincronización cloud:', error);
  }

  interceptarLocalStorage();
  listo = true;

  await Promise.all([...SINCRONIZAR].map(key => {
    const raw = localStorage.getItem(key);
    if (raw === null) return Promise.resolve();
    return enviar(key, parseValor(raw));
  }));
}
