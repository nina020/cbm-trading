export function recomendarCalibracion(comparativa, {
  confirmacionesRequeridas = 3,
  minimoOperaciones = 3,
} = {}) {
  const candidatas = comparativa
    .filter(item => item.umbralMinimo !== null && item.total >= minimoOperaciones)
    .map(item => ({
      umbralMinimo: item.umbralMinimo,
      confirmacionesRequeridas,
      total: item.total,
      winRate: item.winRate,
      pnl: item.pnl,
      maxDrawdown: item.maxDrawdown,
      factorBeneficioRiesgo: item.maxDrawdown > 0
        ? item.pnl / item.maxDrawdown
        : item.pnl > 0 ? item.pnl : 0,
    }))
    .sort((a, b) =>
      Number(b.pnl > 0) - Number(a.pnl > 0)
      || b.factorBeneficioRiesgo - a.factorBeneficioRiesgo
      || b.pnl - a.pnl
      || b.winRate - a.winRate
      || b.total - a.total
    );

  if (!candidatas.length) {
    return {
      disponible: false,
      motivo: `Se necesitan al menos ${minimoOperaciones} operaciones por umbral.`,
    };
  }

  const mejor = candidatas[0];
  return {
    disponible: true,
    ...mejor,
    advertencia: mejor.pnl <= 0
      ? 'La mejor alternativa de la muestra todavía tuvo P&L no positivo.'
      : null,
  };
}

export function createMarketCalibrationStore({ storageKey, storage = localStorage }) {
  let calibraciones = {};

  function guardar() {
    storage.setItem(storageKey, JSON.stringify(calibraciones));
  }

  return {
    cargar() {
      try {
        const data = JSON.parse(storage.getItem(storageKey) || '{}');
        calibraciones = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
      } catch (error) {
        calibraciones = {};
        console.error('No se pudieron cargar las calibraciones por mercado:', error);
      }
      return calibraciones;
    },
    establecer(mercadoId, calibracion) {
      calibraciones[mercadoId] = {
        ...calibracion,
        mercadoId,
        actualizadaEn: new Date().toISOString(),
      };
      guardar();
      return calibraciones[mercadoId];
    },
    obtener(mercadoId) {
      return calibraciones[mercadoId] || null;
    },
    eliminar(mercadoId) {
      delete calibraciones[mercadoId];
      guardar();
    },
    listar() {
      return { ...calibraciones };
    },
  };
}
