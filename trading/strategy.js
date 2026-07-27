import { SL_DESVIACIONES, TP_DESVIACIONES, FILTRO_RUIDO_DESVIACIONES, PERIODO_EMA } from '../config.js';

export function calcularMA(precios) {
  return precios.reduce((total, precio) => total + precio, 0) / precios.length;
}

// EMA (Media Móvil Exponencial) — más reactiva que la MA simple porque
// pondera más los datos recientes. Usada como filtro de tendencia general.
export function calcularEMA(precios, periodo) {
  if (precios.length === 0) return null;
  const k = 2 / (periodo + 1);
  let ema = precios[0];
  for (let i = 1; i < precios.length; i++) {
    ema = precios[i] * k + ema * (1 - k);
  }
  return ema;
}

// RSI con suavizado de Wilder (estándar de TradingView y la mayoría de plataformas).
// Requiere al menos periodo*2 valores para que el suavizado converja correctamente.
// Con menos datos usa promedio simple como respaldo (compatible con la versión anterior).
export function calcularRSI(precios, periodo = 14) {
  const diferencias = [];
  for (let i = 1; i < precios.length; i++) {
    diferencias.push(precios[i] - precios[i - 1]);
  }
  if (diferencias.length === 0) return '50.00';

  // Respaldo: promedio simple cuando hay poco historial.
  if (diferencias.length <= periodo) {
    let ganancias = 0;
    let perdidas = 0;
    for (const d of diferencias) {
      if (d >= 0) ganancias += d;
      else perdidas += Math.abs(d);
    }
    const rs = ganancias / (perdidas || 1);
    return (100 - 100 / (1 + rs)).toFixed(2);
  }

  // Semilla: promedio simple de las primeras `periodo` variaciones.
  let promedioGanancias = 0;
  let promedioPerdidas = 0;
  for (let i = 0; i < periodo; i++) {
    const d = diferencias[i];
    if (d >= 0) promedioGanancias += d;
    else promedioPerdidas += Math.abs(d);
  }
  promedioGanancias /= periodo;
  promedioPerdidas /= periodo;

  // Suavizado de Wilder sobre el resto del historial.
  for (let i = periodo; i < diferencias.length; i++) {
    const d = diferencias[i];
    const g = d >= 0 ? d : 0;
    const p = d < 0 ? Math.abs(d) : 0;
    promedioGanancias = (promedioGanancias * (periodo - 1) + g) / periodo;
    promedioPerdidas = (promedioPerdidas * (periodo - 1) + p) / periodo;
  }

  if (promedioPerdidas === 0) return promedioGanancias === 0 ? '50.00' : '100.00';
  const rs = promedioGanancias / promedioPerdidas;
  return (100 - 100 / (1 + rs)).toFixed(2);
}

export function calcularDesviacion(precios, media) {
  const varianza = precios.reduce(
    (total, precio) => total + Math.pow(precio - media, 2),
    0,
  ) / precios.length;
  return Math.sqrt(varianza);
}

// Detecta niveles de soporte y resistencia buscando los mínimos y máximos
// más repetidos dentro del historial de precios disponible.
// Devuelve el soporte más alto por debajo del precio actual y la resistencia
// más baja por encima, ambos como null si no hay suficiente historial.
export function detectarSoporteResistencia(precios, margen = 0.002) {
  if (precios.length < 10) return { soporte: null, resistencia: null };

  const minimos = [];
  const maximos = [];

  // Buscar mínimos y máximos locales (pivots).
  for (let i = 1; i < precios.length - 1; i++) {
    if (precios[i] <= precios[i - 1] && precios[i] <= precios[i + 1]) {
      minimos.push(precios[i]);
    }
    if (precios[i] >= precios[i - 1] && precios[i] >= precios[i + 1]) {
      maximos.push(precios[i]);
    }
  }

  const precioActual = precios[precios.length - 1];
  const tolerancia = precioActual * margen;

  // Soporte: mínimo local más alto que esté por debajo del precio actual.
  const soportesCandidatos = minimos.filter(m => m < precioActual - tolerancia);
  const soporte = soportesCandidatos.length
    ? Math.max(...soportesCandidatos)
    : null;

  // Resistencia: máximo local más bajo que esté por encima del precio actual.
  const resistenciasCandidatos = maximos.filter(m => m > precioActual + tolerancia);
  const resistencia = resistenciasCandidatos.length
    ? Math.min(...resistenciasCandidatos)
    : null;

  return { soporte, resistencia };
}

/**
 * Clasifica la tendencia general del mercado usando la EMA larga y la
 * estructura de máximos y mínimos (HH/HL = alcista, LH/LL = bajista).
 *
 * Retorna:
 *   'alcista'  — precio sobre la EMA y estructura de máximos crecientes
 *   'bajista'  — precio bajo la EMA y estructura de mínimos decrecientes
 *   'lateral'  — señales contradictorias o historial insuficiente
 *
 * El ebook de Billy Chacón usa la EMA 200 como referencia principal (Módulo 2):
 *   precio > EMA 200 → buscar compras (no ventas)
 *   precio < EMA 200 → buscar ventas (no compras)
 */
export function clasificarTendencia(precios, periodoEma = PERIODO_EMA) {
  if (precios.length < 20) return 'lateral';

  const precio = precios[precios.length - 1];
  const ema = calcularEMA(precios, periodoEma);

  // Estructura: comparar los últimos 3 máximos y mínimos locales.
  const maximos = [];
  const minimos = [];
  for (let i = 1; i < precios.length - 1; i++) {
    if (precios[i] > precios[i - 1] && precios[i] > precios[i + 1]) maximos.push(precios[i]);
    if (precios[i] < precios[i - 1] && precios[i] < precios[i + 1]) minimos.push(precios[i]);
  }

  const ultimosMax = maximos.slice(-3);
  const ultimosMin = minimos.slice(-3);

  // Máximos crecientes (HH) y mínimos crecientes (HL) → estructura alcista.
  const hhhl = ultimosMax.length >= 2
    && ultimosMax[ultimosMax.length - 1] > ultimosMax[ultimosMax.length - 2]
    && (ultimosMin.length < 2 || ultimosMin[ultimosMin.length - 1] > ultimosMin[ultimosMin.length - 2]);

  // Máximos decrecientes (LH) y mínimos decrecientes (LL) → estructura bajista.
  const lhll = ultimosMin.length >= 2
    && ultimosMin[ultimosMin.length - 1] < ultimosMin[ultimosMin.length - 2]
    && (ultimosMax.length < 2 || ultimosMax[ultimosMax.length - 1] < ultimosMax[ultimosMax.length - 2]);

  const sobreEma = ema !== null && precio > ema;
  const bajoEma = ema !== null && precio < ema;

  if (sobreEma && hhhl) return 'alcista';
  if (bajoEma && lhll) return 'bajista';

  // EMA como desempate cuando la estructura no es concluyente.
  if (sobreEma) return 'alcista';
  if (bajoEma) return 'bajista';

  return 'lateral';
}

export function evaluarSenal({
  precio, ma, rsi, desviacion,
  filtroRuido = FILTRO_RUIDO_DESVIACIONES,
  soporte = null,
  resistencia = null,
  tendencia = 'lateral',
}) {
  const desv = Number(desviacion) || 0;
  const distancia = Math.abs(Number(precio) - Number(ma));

  // Filtro 1: ignorar movimientos menores al mínimo de ruido.
  if (distancia < desv * filtroRuido) {
    return { tipo: 'WAIT', sl: null, tp: null };
  }

  if (precio > ma && rsi < 70) {
    // Filtro crítico: no comprar en tendencia bajista (Módulo 2 del ebook).
    if (tendencia === 'bajista') {
      return { tipo: 'WAIT', sl: null, tp: null };
    }
    // Filtro 2: no comprar a menos del 1% de una resistencia.
    if (resistencia !== null && precio >= resistencia * (1 - 0.01)) {
      return { tipo: 'WAIT', sl: null, tp: null };
    }
    return {
      tipo: 'BUY',
      sl: precio - desv * SL_DESVIACIONES,
      tp: precio + desv * TP_DESVIACIONES,
      soporte,
      resistencia,
      tendencia,
    };
  }

  if (precio < ma && rsi > 30) {
    // Filtro crítico: no vender en tendencia alcista (Módulo 2 del ebook).
    if (tendencia === 'alcista') {
      return { tipo: 'WAIT', sl: null, tp: null };
    }
    // Filtro 3: no vender a menos del 1% de un soporte.
    if (soporte !== null && precio <= soporte * (1 + 0.01)) {
      return { tipo: 'WAIT', sl: null, tp: null };
    }
    return {
      tipo: 'SELL',
      sl: precio + desv * SL_DESVIACIONES,
      tp: precio - desv * TP_DESVIACIONES,
      soporte,
      resistencia,
      tendencia,
    };
  }

  return { tipo: 'WAIT', sl: null, tp: null };
}
