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

// Detecta ZONAS de soporte y resistencia agrupando pivots cercanos en clusters.
// Billy Chacón (Módulo 2): "El S/R son zonas, no líneas exactas. Se dibujan
// desde el cuerpo de la vela hasta la mecha más extrema."
// Devuelve { soporte, resistencia, zonaSoporte, zonaResistencia } donde
// las zonas tienen { min, max, centro, rechazos } para dibujarlas en el gráfico.
export function detectarSoporteResistencia(precios, margen = 0.002) {
  if (precios.length < 10) {
    return { soporte: null, resistencia: null, zonaSoporte: null, zonaResistencia: null };
  }

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
  // Agrupamos pivots que estén dentro del 0.25% entre sí en la misma zona.
  const clusterTol = precioActual * 0.0025;

  // Agrupa un array de niveles en zonas (clusters) con conteo de rechazos.
  function agruparZonas(niveles) {
    const zonas = [];
    const usados = new Set();
    for (let i = 0; i < niveles.length; i++) {
      if (usados.has(i)) continue;
      const zona = { min: niveles[i], max: niveles[i], rechazos: 1 };
      for (let j = i + 1; j < niveles.length; j++) {
        if (usados.has(j)) continue;
        const centro = (zona.min + zona.max) / 2;
        if (Math.abs(niveles[j] - centro) <= clusterTol) {
          zona.min = Math.min(zona.min, niveles[j]);
          zona.max = Math.max(zona.max, niveles[j]);
          zona.rechazos++;
          usados.add(j);
        }
      }
      usados.add(i);
      zonas.push({ ...zona, centro: (zona.min + zona.max) / 2 });
    }
    return zonas;
  }

  const zonasMin = agruparZonas(minimos);
  const zonasMax = agruparZonas(maximos);

  // Soporte: zona de mínimos más alta por debajo del precio actual.
  const soportesCandidatos = zonasMin.filter(z => z.max < precioActual - tolerancia);
  const zonaSoporte = soportesCandidatos.length
    ? soportesCandidatos.reduce((a, b) => a.centro > b.centro ? a : b)
    : null;

  // Resistencia: zona de máximos más baja por encima del precio actual.
  const resistenciasCandidatos = zonasMax.filter(z => z.min > precioActual + tolerancia);
  const zonaResistencia = resistenciasCandidatos.length
    ? resistenciasCandidatos.reduce((a, b) => a.centro < b.centro ? a : b)
    : null;

  return {
    soporte: zonaSoporte ? zonaSoporte.centro : null,
    resistencia: zonaResistencia ? zonaResistencia.centro : null,
    zonaSoporte,
    zonaResistencia,
  };
}

/**
 * Detecta si la última vela es explosiva (anti-FOMO).
 * Billy Chacón (Módulo 5): "No entres después de una vela muy grande.
 * El precio necesita consolidar antes de continuar."
 * Una vela es explosiva si su rango supera 2.5x el promedio de las últimas 10.
 * @returns {{ explosiva: boolean, factor: number }}
 */
export function detectarVelaExplosiva(velas) {
  if (velas.length < 5) return { explosiva: false, factor: 0 };
  const muestra = velas.slice(-11, -1);
  if (muestra.length === 0) return { explosiva: false, factor: 0 };
  const rangoPromedio = muestra.reduce((sum, v) => sum + (v.high - v.low), 0) / muestra.length;
  if (rangoPromedio === 0) return { explosiva: false, factor: 0 };
  const ultima = velas[velas.length - 1];
  const factor = (ultima.high - ultima.low) / rangoPromedio;
  return { explosiva: factor >= 2.5, factor: parseFloat(factor.toFixed(1)) };
}

/**
 * Detecta un breakout + retest de una zona S/R.
 * Billy Chacón (Módulo 2): "El breakout con retest es la entrada más fuerte
 * porque el precio rompió la zona y volvió a confirmarla."
 * Busca en la ventana reciente: (1) ruptura del nivel, (2) retorno al nivel,
 * (3) precio actual en la dirección del breakout.
 * @returns {{ tipo: 'BUY'|'SELL'|null, nivel: number|null }}
 */
export function detectarBreakoutRetest(precios, soporte, resistencia) {
  if (precios.length < 15) return { tipo: null, nivel: null };
  const precio = precios[precios.length - 1];
  const ventana = precios.slice(-20);
  const tol = precio * 0.0015; // 0.15% de tolerancia

  // Breakout alcista: precio rompió la resistencia, volvió a ella (retest) y rebotó arriba.
  if (resistencia !== null) {
    const antes = ventana.slice(0, -5);
    const despues = ventana.slice(-5);
    const rompio = antes.some(p => p > resistencia + tol);
    const retesto = despues.some(p => Math.abs(p - resistencia) <= tol * 4);
    if (rompio && retesto && precio > resistencia) {
      return { tipo: 'BUY', nivel: resistencia };
    }
  }

  // Breakout bajista: precio rompió el soporte, volvió a él (retest) y rebotó abajo.
  if (soporte !== null) {
    const antes = ventana.slice(0, -5);
    const despues = ventana.slice(-5);
    const rompio = antes.some(p => p < soporte - tol);
    const retesto = despues.some(p => Math.abs(p - soporte) <= tol * 4);
    if (rompio && retesto && precio < soporte) {
      return { tipo: 'SELL', nivel: soporte };
    }
  }

  return { tipo: null, nivel: null };
}

/**
 * Evalúa las 4 confirmaciones obligatorias del checklist de Billy Chacón (Módulo 5).
 * Las 4 confirmaciones son:
 *   C1 — Tendencia definida (alcista o bajista, con EMA 200)
 *   C2 — Precio en zona clave de soporte o resistencia
 *   C3 — Acción del precio confirmada (rechazo, break+retest)
 *   C4 — Vela confirmatoria (Martillo, Engulfing, Pin Bar, Marubozu)
 * @returns {{ c1, c2, c3, c4, total, completo }}
 */
export function evaluarConfirmaciones({
  precio,
  soporte = null,
  resistencia = null,
  tendencia = 'lateral',
  patronAlcista = null,
  patronBajista = null,
  breakoutRetest = { tipo: null, nivel: null },
  tipoSenal = 'WAIT',
}) {
  // C1: Tendencia definida (no lateral)
  const c1ok = tendencia === 'alcista' || tendencia === 'bajista';
  const c1detalle = tendencia === 'lateral' || tendencia === undefined
    ? 'Sin dirección clara'
    : `${tendencia.charAt(0).toUpperCase() + tendencia.slice(1)} · EMA 200`;

  // C2: Precio cerca de una zona clave S/R (dentro del 0.5%)
  const tol = precio * 0.005;
  const enSoporte = soporte !== null && Math.abs(precio - soporte) <= tol * 2;
  const enResistencia = resistencia !== null && Math.abs(precio - resistencia) <= tol * 2;
  const c2ok = enSoporte || enResistencia;
  const c2detalle = enSoporte
    ? `En zona de soporte (${soporte.toFixed(3)})`
    : enResistencia
    ? `En zona de resistencia (${resistencia.toFixed(3)})`
    : 'Fuera de zona clave S/R';

  // C3: Acción del precio (break+retest, rechazo en zona, o impulso desde nivel)
  const hayBreakout = breakoutRetest.tipo !== null;
  const rechazoBajista = tendencia === 'bajista' && enResistencia;
  const rechazoAlcista = tendencia === 'alcista' && enSoporte;
  const c3ok = hayBreakout || rechazoBajista || rechazoAlcista;
  const c3detalle = hayBreakout
    ? `Break + Retest en ${breakoutRetest.nivel?.toFixed(3)}`
    : rechazoBajista
    ? 'Rechazo bajista en resistencia'
    : rechazoAlcista
    ? 'Rechazo alcista en soporte'
    : 'Sin confirmación de acción del precio';

  // C4: Vela confirmatoria en la dirección de la señal
  const patronFavor = tipoSenal === 'BUY' ? patronAlcista : tipoSenal === 'SELL' ? patronBajista : null;
  const c4ok = patronFavor !== null;
  const c4detalle = patronFavor ?? 'Sin vela confirmatoria';

  const total = [c1ok, c2ok, c3ok, c4ok].filter(Boolean).length;

  return {
    c1: { ok: c1ok, label: '1. Tendencia', detalle: c1detalle },
    c2: { ok: c2ok, label: '2. Zona clave', detalle: c2detalle },
    c3: { ok: c3ok, label: '3. Acción del precio', detalle: c3detalle },
    c4: { ok: c4ok, label: '4. Vela confirmatoria', detalle: c4detalle },
    total,
    completo: total >= 4,
  };
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

/**
 * Detecta si el mercado está en un rango (consolidación lateral).
 *
 * El ebook (Módulo 5, tema 61 "¿Cuándo NO operar?") dice explícitamente:
 * "En consolidación — el precio rebota entre un soporte y una resistencia
 * sin tendencia clara. Las señales de MA pierden validez aquí."
 *
 * Un mercado está en rango cuando:
 * 1. La amplitud del precio reciente (max - min) es pequeña relativa al precio.
 * 2. Tanto soporte como resistencia están detectados y están cerca entre sí.
 * 3. El RSI ronda el 50 sin tendencia clara (ni sobrecompra ni sobreventa).
 *
 * @param {number[]} precios   - historial reciente de precios
 * @param {number}   rsi       - RSI actual (número)
 * @param {number|null} soporte
 * @param {number|null} resistencia
 * @param {number}   umbralRango - amplitud máxima como % del precio para
 *                                 considerar que es rango (por defecto 0.5%)
 * @returns {{ enRango: boolean, amplitud: number, razon: string }}
 */
export function detectarRango(precios, rsi, soporte, resistencia, umbralRango = 0.005) {
  if (precios.length < 10) return { enRango: false, amplitud: 0, razon: 'historial insuficiente' };

  const precio = precios[precios.length - 1];
  const maxReciente = Math.max(...precios);
  const minReciente = Math.min(...precios);
  const amplitud = (maxReciente - minReciente) / precio;

  // Condición 1: precio encerrado en una banda estrecha.
  const bandaEstrecha = amplitud < umbralRango;

  // Condición 2: ambos niveles S/R detectados y el precio cabe entre ellos
  // con poco espacio libre (el rango S/R es pequeño relativo al precio).
  const rsiNumero = Number(rsi);
  const srCercanos = soporte !== null && resistencia !== null
    && (resistencia - soporte) / precio < umbralRango * 3;

  // Condición 3: RSI neutro (entre 40 y 60) sin impulso claro.
  const rsiNeutro = rsiNumero >= 40 && rsiNumero <= 60;

  // Se considera rango cuando al menos 2 de las 3 condiciones se cumplen.
  const condicionesCumplidas = [bandaEstrecha, srCercanos, rsiNeutro]
    .filter(Boolean).length;
  const enRango = condicionesCumplidas >= 2;

  const razon = enRango
    ? [
        bandaEstrecha ? `amplitud ${(amplitud * 100).toFixed(2)}%` : null,
        srCercanos ? 'S/R cercanos' : null,
        rsiNeutro ? `RSI neutro (${rsiNumero.toFixed(0)})` : null,
      ].filter(Boolean).join(', ')
    : '';

  return { enRango, amplitud, razon };
}

export function evaluarSenal({
  precio, ma, rsi, desviacion,
  filtroRuido = FILTRO_RUIDO_DESVIACIONES,
  soporte = null,
  resistencia = null,
  tendencia = 'lateral',
  enRango = false,
  velaExplosiva = false,  // Cambio #4: filtro anti-FOMO (Módulo 5)
}) {
  const desv = Number(desviacion) || 0;
  const distancia = Math.abs(Number(precio) - Number(ma));

  // Filtro 1: ignorar movimientos menores al mínimo de ruido.
  if (distancia < desv * filtroRuido) {
    return { tipo: 'WAIT', sl: null, tp: null, razon: 'precio muy cercano a la MA' };
  }

  // Filtro de rango: el ebook dice explícitamente no operar en consolidación
  // (Módulo 5, tema 61). Las señales de MA pierden validez en mercado lateral.
  if (enRango) {
    return { tipo: 'WAIT', sl: null, tp: null, razon: 'consolidación detectada' };
  }

  // Filtro de vela explosiva (Cambio #4): bloquear entrada por FOMO.
  // Billy Chacón: "No entres después de una vela muy grande."
  if (velaExplosiva) {
    return { tipo: 'WAIT', sl: null, tp: null, razon: 'vela explosiva — esperar normalización' };
  }

  if (precio > ma && rsi < 70) {
    // Filtro crítico: no comprar en tendencia bajista (Módulo 2 del ebook).
    if (tendencia === 'bajista') {
      return { tipo: 'WAIT', sl: null, tp: null, razon: 'contra la tendencia bajista' };
    }
    // Filtro 2: no comprar a menos del 1% de una resistencia.
    if (resistencia !== null && precio >= resistencia * (1 - 0.01)) {
      return { tipo: 'WAIT', sl: null, tp: null, razon: 'precio muy cerca de resistencia' };
    }
    return {
      tipo: 'BUY',
      sl: precio - desv * SL_DESVIACIONES,
      tp: precio + desv * TP_DESVIACIONES,
      soporte, resistencia, tendencia, razon: null,
    };
  }

  if (precio < ma && rsi > 30) {
    // Filtro crítico: no vender en tendencia alcista (Módulo 2 del ebook).
    if (tendencia === 'alcista') {
      return { tipo: 'WAIT', sl: null, tp: null, razon: 'contra la tendencia alcista' };
    }
    // Filtro 3: no vender a menos del 1% de un soporte.
    if (soporte !== null && precio <= soporte * (1 + 0.01)) {
      return { tipo: 'WAIT', sl: null, tp: null, razon: 'precio muy cerca de soporte' };
    }
    return {
      tipo: 'SELL',
      sl: precio + desv * SL_DESVIACIONES,
      tp: precio - desv * TP_DESVIACIONES,
      soporte, resistencia, tendencia, razon: null,
    };
  }

  return { tipo: 'WAIT', sl: null, tp: null, razon: 'sin condiciones de entrada' };
}
