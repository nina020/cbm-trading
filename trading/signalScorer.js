export const SIGNAL_CONFIG_DEFAULTS = {
  umbralMinimo: 70,
  confirmacionesRequeridas: 3,
  filtrarAutoTrading: true,
};

function limitar(value, minimo, maximo) {
  return Math.min(maximo, Math.max(minimo, value));
}

export function normalizarSignalConfig(config = {}) {
  return {
    umbralMinimo: limitar(Number(config.umbralMinimo) || 70, 50, 95),
    confirmacionesRequeridas: limitar(
      Math.round(Number(config.confirmacionesRequeridas) || 3),
      1,
      10,
    ),
    filtrarAutoTrading: config.filtrarAutoTrading !== false,
  };
}

export function puntuarSenal({ tipo, precio, ma, rsi, desviacion, precios = [] }) {
  if (!['BUY', 'SELL'].includes(tipo)) {
    return { puntuacion: 0, nivel: 'sin señal', factores: [] };
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

  const puntuacion = Math.round(
    puntosTendencia + puntosRsi + puntosMomentum + puntosConsistencia,
  );
  const nivel = puntuacion >= 80 ? 'fuerte' : puntuacion >= 65 ? 'moderada' : 'débil';

  return {
    puntuacion,
    nivel,
    factores: [
      { nombre: 'Tendencia', puntos: Math.round(puntosTendencia), maximo: 30 },
      { nombre: 'RSI', puntos: Math.round(puntosRsi), maximo: 25 },
      { nombre: 'Momentum', puntos: Math.round(puntosMomentum), maximo: 25 },
      { nombre: 'Consistencia', puntos: Math.round(puntosConsistencia), maximo: 20 },
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
