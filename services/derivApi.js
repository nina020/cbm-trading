async function requestJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Error consultando Deriv');
  return data;
}

export async function obtenerWsUrl() {
  const data = await requestJson('/api/ws-url');
  return data.url;
}

export function obtenerCuenta() {
  return requestJson('/api/account');
}
