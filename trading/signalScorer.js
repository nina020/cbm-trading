import { evaluarPatronesVela } from './candlePatterns.js';

export const SIGNAL_CONFIG_DEFAULTS = {
  umbralMinimo: 65,
  confirmacionesRequeridas: 2,
  filtrarAutoTrading: true,
  basketDemoEnabled: false,
  basketSize: 3,
  basketMinQuality: 85,
  basketMinMarketScore: 60,
  basketMinHistory: 0,
  basketMinWinRate: 60,
};

function limitar(value, minimo, maximo) {
  return Math.min(maximo, Math.max(minimo, value));
}

export function normalizarSignalConfig(config = {}) {
  return {
    umbralMinimo: limitar(
      Number(config.umbralMinimo) || SIGNAL_CONFIG_DEFAULTS.umbralMinimo,
      50, 95,
    ),
    confirmacionesRequeridas: limitar(
      Math.round(Number(config.confirmacionesRequeridas) || SIGNAL_CONFIG_DEFAULTS.confirmacionesRequeridas),
      1,
      10,
    ),
    filtrarAutoTrading: config.filtrarAutoTrading !== false,
    basketDemoEnabled: config.basketDemoEnabled === true,
    basketSize: limitar(Math.round(Number(config.basketSize) || 3), 2, 5),
    basketMinQuality: limitar(Math.round(Number(config.basketMinQuality) || 85), 70, 95),
    basketMinMarketScore: limitar(Math.round(Number(config.basketMinMarketScore) || 60), 0, 100),
    basketMinHistory: limitar(Math.round(Number(config.basketMinHistory) || 0), 0, 100),
    basketMinWinRate: limitar(Math.round(Number(config.basketMinWinRate) || 60), 0, 100),
  };
}

export function puntuarSenal({ tipo, precio, ma, rsi, desviacion, precios = [], velas = [] }) {
  if (!['BUY', 'SELL'].includes(tipo)) {
    return { puntuacion: 0, nivel: 'sin señal', factores: [], confluencia: 0 };
  }

  const direccion = tipo === 'BUY' ? 1 : -1;
  const desviacionSegura = Math.max(Number(desviacion) || 0, Number.EPSILON);
  const distanciaTendencia = ((Number(precio) - Number(ma)) * direccion) / desviacionSegura;
  const puntosTendencia = limitar(distanciaTendencia / 2, 0, 1) * 30;

  const rsiNumero = Number(rsi);
  const rsiIdeal = tipo === 'BUY' ? 60 : 40;
  const puntosRsi = limitar(1 - Math.abs(rsiNumero - rsiIdeal) / 30, 0, 1) * 25;

  const primero = Number(precios[0]);
  const ultimo = Number(precios[precios.length - 1]);
  const movimiento = Number.isFinite(primero) && Number.isFinite(ultimo)
    ? ((ultimo - primero) * direccion) / desviacionSegura
    : 0;
  const puntosMomentum = limitar(movimiento / 3, 0, 1) * 25;

  const cambios = precios.slice(1).map((valor, indice) => Number(valor) - Number(precios[indice]));
  const cambiosFavorables = cambios.filter(cambio => cambio * direccion > 0).length;
  const consistencia = cambios.length ? cambiosFavorables / cambios.length : 0;
  const puntosConsistencia = consistencia * 20;

  // Fuerza del cuerpo de vela (Módulo 3 del ebook de Billy Chacón).
  // Velas con cuerpo grande = mayor convicción. Se evalúa la última vela completa.
  let puntosCuerpo = 0;
  if (velas.length > 0) {
    const ultimaVela = velas[velas.length - 1];
    const cuerpoVela = Math.abs(ultimaVela.close - ultimaVela.open);
    const rangoVela = ultimaVela.high - ultimaVela.low;
    if (rangoVela > 0) {
      const fuerza = cuerpoVela / rangoVela;
      puntosCuerpo = limitar(fuerza, 0, 1) * 15;
      // Vela en la dirección correcta = fuerza extra, contraria = resta.
      const velaFavor = tipo === 'BUY'
        ? ultimaVela.close > ultimaVela.open
        : ultimaVela.close < ultimaVela.open;
      if (!velaFavor) puntosCuerpo = -puntosCuerpo * 0.5;
    }
  }

  // Bonificación por patrones de velas japonesas (del ebook de Billy Chacón).
  // Suma hasta +20 si el patrón confirma la señal, resta hasta -20 si la contradice.
  const { patronAlcista, patronBajista, bonificacion: bonificacionPatron } =
    evaluarPatronesVela(velas, tipo);

  // Confluencia: cuántos factores superan un umbral mínimo individualmente.
  // El ebook (Módulo 5, checklist) exige mínimo 4 confirmaciones antes de entrar.
  // Aquí medimos cuántos de los 4 factores principales superan el 50% de su máximo.
  const factoresActivos = [
    puntosTendencia > 15,     // tendencia clara (>50% de 30)
    puntosRsi > 12,           // RSI en zona correcta (>50% de 25)
    puntosMomentum > 12,      // momentum a favor (>50% de 25)
    puntosConsistencia > 10,  // precio consistente (>50% de 20)
  ].filter(Boolean).length;

  const puntuacion = Math.min(100, Math.max(0, Math.round(
    puntosTendencia + puntosRsi + puntosMomentum + puntosConsistencia
    + puntosCuerpo + bonificacionPatron,
  )));

  // La señal necesita al menos 2 factores activos para considerarse válida.
  // Con 0-1 factores activos la señal se marca como débil independientemente
  // de la puntuación total, porque podría ser una coincidencia.
  const confluenciaInsuficiente = factoresActivos < 2;
  const puntuacionFinal = confluenciaInsuficiente
    ? Math.min(puntuacion, 50)  // capping a 50 si no hay confluencia
    : puntuacion;

  const nivel = puntuacionFinal >= 80 ? 'fuerte'
    : puntuacionFinal >= 65 ? 'moderada'
    : 'débil';

  return {
    puntuacion: puntuacionFinal,
    nivel,
    confluencia: factoresActivos,
    patronAlcista,
    patronBajista,
    factores: [
      { nombre: 'Tendencia', puntos: Math.round(puntosTendencia), maximo: 30 },
      { nombre: 'RSI', puntos: Math.round(puntosRsi), maximo: 25 },
      { nombre: 'Momentum', puntos: Math.round(puntosMomentum), maximo: 25 },
      { nombre: 'Consistencia', puntos: Math.round(puntosConsistencia), maximo: 20 },
      { nombre: 'Cuerpo de vela', puntos: Math.round(puntosCuerpo), maximo: 15 },
      { nombre: 'Patrón de vela', puntos: bonificacionPatron, maximo: 20 },
    ],
  };
}

export function createSignalTrigger() {
  let tipoActual = 'WAIT';
  let confirmaciones = 0;
  let ejecutada = false;

  return {
    evaluar({ tipo, puntuacion, activo, config }) {
      if (tipo === 'WAIT') {
        tipoActual = 'WAIT';
        confirmaciones = 0;
        ejecutada = false;
        return {
          ejecutar: false, confirmaciones, superaUmbral: false, confirmada: false,
        };
      }

      if (tipo === tipoActual) {
        confirmaciones++;
      } else {
        tipoActual = tipo;
        confirmaciones = 1;
        ejecutada = false;
      }

      const superaUmbral = puntuacion >= config.umbralMinimo;
      const confirmada = confirmaciones >= config.confirmacionesRequeridas;
      const lista = !config.filtrarAutoTrading || (superaUmbral && confirmada);
      const ejecutar = Boolean(activo && lista && !ejecutada);

      if (ejecutar) ejecutada = true;
      return { ejecutar, confirmaciones, superaUmbral, confirmada };
    },
    liberar() {
      ejecutada = false;
    },
  };
}
