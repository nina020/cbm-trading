/**
 * chartPatterns.js — Detección de patrones geométricos de chart.
 * Billy Chacón (Módulo 4): triángulos, flags y canales como contexto para la entrada.
 * Se implementan los dos más frecuentes en Boom/Crash: triángulo simétrico y flag.
 */

/**
 * Regresión lineal simple sobre un array de valores.
 * Devuelve { pendiente, intercepcion, r2 } donde r2 ∈ [0,1] mide el ajuste.
 */
function regresionLineal(valores) {
  const n = valores.length;
  if (n < 2) return { pendiente: 0, intercepcion: valores[0] ?? 0, r2: 0 };
  const xMedia = (n - 1) / 2;
  const yMedia = valores.reduce((a, b) => a + b, 0) / n;
  let ssXY = 0, ssXX = 0, ssYY = 0;
  for (let i = 0; i < n; i++) {
    ssXY += (i - xMedia) * (valores[i] - yMedia);
    ssXX += (i - xMedia) ** 2;
    ssYY += (valores[i] - yMedia) ** 2;
  }
  const pendiente = ssXX !== 0 ? ssXY / ssXX : 0;
  const intercepcion = yMedia - pendiente * xMedia;
  const r2 = ssYY !== 0 ? (ssXY ** 2) / (ssXX * ssYY) : 0;
  return { pendiente, intercepcion, r2 };
}

/**
 * Extrae máximos y mínimos locales (pivots) de un array de velas.
 * Usa ventana de `radio` velas a cada lado para suavizar el ruido.
 */
function extraerPivots(velas, radio = 2) {
  const maximos = [];
  const minimos = [];
  for (let i = radio; i < velas.length - radio; i++) {
    const high = velas[i].high;
    const low = velas[i].low;
    const esMax = velas.slice(i - radio, i).every(v => v.high <= high)
      && velas.slice(i + 1, i + radio + 1).every(v => v.high <= high);
    const esMin = velas.slice(i - radio, i).every(v => v.low >= low)
      && velas.slice(i + 1, i + radio + 1).every(v => v.low >= low);
    if (esMax) maximos.push({ indice: i, valor: high });
    if (esMin) minimos.push({ indice: i, valor: low });
  }
  return { maximos, minimos };
}

/**
 * Detecta triángulo simétrico.
 * Condición: maximos con pendiente negativa y mínimos con pendiente positiva,
 * ambas líneas convergentes (se van acercando), con ajuste r2 aceptable.
 *
 * @param {Array<{open,high,low,close}>} velas
 * @returns {{ detectado: boolean, direccion: 'BUY'|'SELL'|null, fuerza: number }}
 *   fuerza ∈ [0,1] — qué tan limpio es el patrón.
 */
export function detectarTriangulo(velas) {
  if (velas.length < 15) return { detectado: false, direccion: null, fuerza: 0 };

  const { maximos, minimos } = extraerPivots(velas, 2);
  if (maximos.length < 3 || minimos.length < 3) return { detectado: false, direccion: null, fuerza: 0 };

  const regMax = regresionLineal(maximos.map(p => p.valor));
  const regMin = regresionLineal(minimos.map(p => p.valor));

  // Triángulo simétrico: techos bajan y suelos suben.
  const techoBaja = regMax.pendiente < 0;
  const sueloSube = regMin.pendiente > 0;
  if (!techoBaja || !sueloSube) return { detectado: false, direccion: null, fuerza: 0 };

  // R² mínimo de 0.5 para que las líneas sean razonablemente rectas.
  if (regMax.r2 < 0.5 || regMin.r2 < 0.5) return { detectado: false, direccion: null, fuerza: 0 };

  // Convergencia: la distancia entre las dos líneas al final debe ser menor que al inicio.
  const distanciaInicio = Math.abs(maximos[0].valor - minimos[0].valor);
  const distanciaFin = Math.abs(maximos[maximos.length - 1].valor - minimos[minimos.length - 1].valor);
  if (distanciaFin >= distanciaInicio * 0.9) return { detectado: false, direccion: null, fuerza: 0 };

  // Dirección del breakout se estima por la tendencia previa al triángulo:
  // si el precio llegó de abajo → probable BUY; de arriba → probable SELL.
  const precioInicio = velas[0].close;
  const precioMedio = velas[Math.floor(velas.length / 2)].close;
  const direccion = precioMedio > precioInicio ? 'BUY' : 'SELL';

  const fuerza = Math.min(1, (regMax.r2 + regMin.r2) / 2);
  return { detectado: true, direccion, fuerza: parseFloat(fuerza.toFixed(2)) };
}

/**
 * Detecta patrón flag (bandera).
 * Estructura: impulso fuerte seguido de canal estrecho en sentido contrario.
 * El canal tiene pendiente opuesta al impulso — indica consolidación antes de continuación.
 *
 * @param {Array<{open,high,low,close}>} velas
 * @returns {{ detectado: boolean, direccion: 'BUY'|'SELL'|null, fuerza: number }}
 */
export function detectarFlag(velas) {
  if (velas.length < 12) return { detectado: false, direccion: null, fuerza: 0 };

  // Dividir la ventana en dos mitades: primera = mástil (impulso), segunda = bandera (canal).
  const mitad = Math.floor(velas.length / 2);
  const mastil = velas.slice(0, mitad);
  const bandera = velas.slice(mitad);

  // Mástil: movimiento total grande (al menos 1.5 desviaciones del rango promedio).
  const rangoPromedio = velas.reduce((s, v) => s + (v.high - v.low), 0) / velas.length;
  const movMastil = mastil[mastil.length - 1].close - mastil[0].close;
  const magnitudMastil = Math.abs(movMastil);
  if (magnitudMastil < rangoPromedio * 3) return { detectado: false, direccion: null, fuerza: 0 };

  const direccionMastil = movMastil > 0 ? 'BUY' : 'SELL';

  // Bandera: canal estrecho — regresión lineal sobre cierres con r² alto y pendiente opuesta al mástil.
  const cierresBandera = bandera.map(v => v.close);
  const regBandera = regresionLineal(cierresBandera);

  // Pendiente opuesta al mástil (corrección leve).
  const pendienteOpuesta = direccionMastil === 'BUY' ? regBandera.pendiente < 0 : regBandera.pendiente > 0;
  if (!pendienteOpuesta) return { detectado: false, direccion: null, fuerza: 0 };

  // El movimiento de la bandera debe ser menor que el 50% del mástil (es una corrección).
  const movBandera = Math.abs(cierresBandera[cierresBandera.length - 1] - cierresBandera[0]);
  if (movBandera > magnitudMastil * 0.5) return { detectado: false, direccion: null, fuerza: 0 };

  // R² de la bandera razonable (canal relativamente limpio).
  if (regBandera.r2 < 0.4) return { detectado: false, direccion: null, fuerza: 0 };

  // Fuerza: relación entre el tamaño del mástil y el ruido de la bandera.
  const fuerza = Math.min(1, (magnitudMastil / (rangoPromedio * 5)) * regBandera.r2);
  return {
    detectado: true,
    direccion: direccionMastil,
    fuerza: parseFloat(fuerza.toFixed(2)),
  };
}

/**
 * Función principal: detecta todos los patrones geométricos disponibles.
 * Devuelve el patrón más fuerte detectado (o null si no hay ninguno).
 *
 * @param {Array<{open,high,low,close}>} velas
 * @returns {{ nombre: string|null, direccion: 'BUY'|'SELL'|null, fuerza: number, bonificacion: number }}
 */
export function detectarPatronGeometrico(velas) {
  const triangulo = detectarTriangulo(velas);
  const flag = detectarFlag(velas);

  // Elegir el más fuerte.
  let mejor = { nombre: null, direccion: null, fuerza: 0, bonificacion: 0 };

  if (triangulo.detectado && triangulo.fuerza > mejor.fuerza) {
    mejor = {
      nombre: 'Triángulo simétrico',
      direccion: triangulo.direccion,
      fuerza: triangulo.fuerza,
      bonificacion: Math.round(triangulo.fuerza * 15), // hasta +15 puntos en puntuarSenal
    };
  }
  if (flag.detectado && flag.fuerza > mejor.fuerza) {
    mejor = {
      nombre: 'Flag',
      direccion: flag.direccion,
      fuerza: flag.fuerza,
      bonificacion: Math.round(flag.fuerza * 15),
    };
  }

  return mejor;
}
