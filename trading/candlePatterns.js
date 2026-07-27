/**
 * Detección de patrones de velas japonesas.
 * Basado en la metodología del ebook "Trading desde Cero" de Billy Chacón
 * (Módulo 3: Patrones de vela).
 *
 * Cada función recibe un array de velas { open, high, low, close }
 * en orden cronológico (la última es la más reciente).
 */

function cuerpo(v) { return Math.abs(v.close - v.open); }
function rango(v) { return v.high - v.low; }
function mechaInf(v) { return Math.min(v.open, v.close) - v.low; }
function mechaSup(v) { return v.high - Math.max(v.open, v.close); }
function esAlcista(v) { return v.close > v.open; }
function esBajista(v) { return v.close < v.open; }

export function esMartillo(v) {
  const c = cuerpo(v), r = rango(v);
  if (r === 0) return false;
  return mechaInf(v) >= c * 2 && mechaSup(v) <= c * 0.5 && c <= r * 0.4;
}

export function esHombreColgado(v) {
  return esMartillo(v);
}

export function esPinBarBajista(v) {
  const c = cuerpo(v), r = rango(v);
  if (r === 0) return false;
  return mechaSup(v) >= c * 2 && mechaInf(v) <= c * 0.5 && c <= r * 0.4;
}

export function esDoji(v) {
  const r = rango(v);
  if (r === 0) return true;
  return cuerpo(v) / r < 0.1;
}

export function esMarubozuAlcista(v) {
  const c = cuerpo(v), r = rango(v);
  if (r === 0) return false;
  return esAlcista(v) && c / r >= 0.9 && mechaSup(v) <= c * 0.05 && mechaInf(v) <= c * 0.05;
}

export function esMarubozuBajista(v) {
  const c = cuerpo(v), r = rango(v);
  if (r === 0) return false;
  return esBajista(v) && c / r >= 0.9 && mechaSup(v) <= c * 0.05 && mechaInf(v) <= c * 0.05;
}

export function esEnvolventeAlcista(velas) {
  if (velas.length < 2) return false;
  const [a, b] = velas.slice(-2);
  return esBajista(a) && esAlcista(b) && b.open < a.close && b.close > a.open;
}

export function esEnvolventeBajista(velas) {
  if (velas.length < 2) return false;
  const [a, b] = velas.slice(-2);
  return esAlcista(a) && esBajista(b) && b.open > a.close && b.close < a.open;
}

export function esEstrellaMannana(velas) {
  if (velas.length < 3) return false;
  const [v1, v2, v3] = velas.slice(-3);
  return (
    esBajista(v1) && cuerpo(v1) > rango(v1) * 0.5 &&
    cuerpo(v2) < cuerpo(v1) * 0.4 &&
    esAlcista(v3) && v3.close > (v1.open + v1.close) / 2
  );
}

export function esEstrellaTarde(velas) {
  if (velas.length < 3) return false;
  const [v1, v2, v3] = velas.slice(-3);
  return (
    esAlcista(v1) && cuerpo(v1) > rango(v1) * 0.5 &&
    cuerpo(v2) < cuerpo(v1) * 0.4 &&
    esBajista(v3) && v3.close < (v1.open + v1.close) / 2
  );
}

export function esTresSoldados(velas) {
  if (velas.length < 3) return false;
  const [v1, v2, v3] = velas.slice(-3);
  return (
    esAlcista(v1) && esAlcista(v2) && esAlcista(v3) &&
    v2.open > v1.open && v2.open < v1.close &&
    v3.open > v2.open && v3.open < v2.close &&
    mechaSup(v1) <= cuerpo(v1) * 0.3 &&
    mechaSup(v2) <= cuerpo(v2) * 0.3 &&
    mechaSup(v3) <= cuerpo(v3) * 0.3
  );
}

export function esTresCuervos(velas) {
  if (velas.length < 3) return false;
  const [v1, v2, v3] = velas.slice(-3);
  return (
    esBajista(v1) && esBajista(v2) && esBajista(v3) &&
    v2.open < v1.open && v2.open > v1.close &&
    v3.open < v2.open && v3.open > v2.close &&
    mechaInf(v1) <= cuerpo(v1) * 0.3 &&
    mechaInf(v2) <= cuerpo(v2) * 0.3 &&
    mechaInf(v3) <= cuerpo(v3) * 0.3
  );
}

/**
 * Evalúa el historial de velas y devuelve el patrón detectado y
 * una bonificación de puntos para la señal actual.
 */
export function evaluarPatronesVela(velas, tipoSenal) {
  if (!velas || velas.length < 1) {
    return { patronAlcista: null, patronBajista: null, bonificacion: 0 };
  }
  const ultima = velas[velas.length - 1];
  let patronAlcista = null;
  let patronBajista = null;

  if (esTresSoldados(velas))            patronAlcista = 'Tres soldados blancos';
  else if (esEstrellaMannana(velas))    patronAlcista = 'Estrella de la manana';
  else if (esEnvolventeAlcista(velas))  patronAlcista = 'Envolvente alcista';
  else if (esMartillo(ultima))          patronAlcista = 'Martillo';
  else if (esMarubozuAlcista(ultima))   patronAlcista = 'Marubozu alcista';

  if (esTresCuervos(velas))                              patronBajista = 'Tres cuervos negros';
  else if (esEstrellaTarde(velas))                       patronBajista = 'Estrella de la tarde';
  else if (esEnvolventeBajista(velas))                  patronBajista = 'Envolvente bajista';
  else if (esPinBarBajista(ultima))                      patronBajista = 'Pin bar bajista';
  else if (esMarubozuBajista(ultima))                    patronBajista = 'Marubozu bajista';
  else if (esHombreColgado(ultima) && esAlcista(ultima)) patronBajista = 'Hombre colgado';

  let bonificacion = 0;
  const fuerte = p => p && (p.includes('soldados') || p.includes('tarde') || p.includes('mannana') || p.includes('cuervos'));
  if (tipoSenal === 'BUY') {
    if (patronAlcista) bonificacion += fuerte(patronAlcista) ? 20 : 10;
    if (patronBajista) bonificacion -= fuerte(patronBajista) ? 20 : 10;
  } else if (tipoSenal === 'SELL') {
    if (patronBajista) bonificacion += fuerte(patronBajista) ? 20 : 10;
    if (patronAlcista) bonificacion -= fuerte(patronAlcista) ? 20 : 10;
  }

  return { patronAlcista, patronBajista, bonificacion };
}
