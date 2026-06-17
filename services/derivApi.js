async function requestJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Error consultando Deriv');
  return data;
}

function accountQuery(accountMode) {
  return accountMode ? `?account=${encodeURIComponent(accountMode)}` : '';
}

export async function obtenerWsUrl(accountMode = 'demo') {
  const data = await requestJson(`/api/ws-url${accountQuery(accountMode)}`);
  return data.url;
}

export function obtenerCuenta(accountMode = 'demo') {
  return requestJson(`/api/account${accountQuery(accountMode)}`);
}
