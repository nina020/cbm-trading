export const BASKET_CONFIG_DEFAULTS = {
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

export function normalizarBasketConfig(config = {}) {
  return {
    basketDemoEnabled: config.basketDemoEnabled === true,
    basketSize: limitar(Math.round(Number(config.basketSize) || 3), 2, 5),
    basketMinQuality: limitar(Math.round(Number(config.basketMinQuality) || 85), 70, 95),
    basketMinMarketScore: limitar(Math.round(Number(config.basketMinMarketScore) || 60), 0, 100),
    basketMinHistory: limitar(Math.round(Number(config.basketMinHistory) || 0), 0, 100),
    basketMinWinRate: limitar(Math.round(Number(config.basketMinWinRate) || 60), 0, 100),
  };
}

export function seleccionarMercadosCanasta(mercados = [], config = {}) {
  const normalizada = normalizarBasketConfig(config);
  return mercados
    .filter(mercado => (
      mercado.listo
      && ['recomendable', 'considerar'].includes(mercado.nivel)
      && Number(mercado.puntuacion) >= normalizada.basketMinMarketScore
    ))
    .sort((a, b) => Number(b.puntuacion) - Number(a.puntuacion))
    .slice(0, normalizada.basketSize);
}

export function resumirHistorialCanasta(registros = [], mercadoId) {
  const cerradas = registros.filter(item => (
    item.modo === 'demo'
    && item.mercadoId === mercadoId
    && ['ganada', 'perdida'].includes(item.estado)
  ));
  const ganadas = cerradas.filter(item => item.estado === 'ganada').length;
  return {
    total: cerradas.length,
    ganadas,
    perdidas: cerradas.length - ganadas,
    winRate: cerradas.length ? (ganadas / cerradas.length) * 100 : null,
  };
}

export function evaluarCandidatoCanasta({
  config,
  modo,
  mercadoId,
  calidad,
  mercadoPuntuacion = null,
  topMarketIds = [],
  registros = [],
}) {
  const normalizada = normalizarBasketConfig(config);
  const pendientes = registros.filter(item => (
    item.modo === 'demo'
    && item.tipoEjecucion === 'canasta_3x'
    && item.estado === 'pendiente'
  ));
  const historial = resumirHistorialCanasta(registros, mercadoId);

  if (!normalizada.basketDemoEnabled) {
    return { permitido: false, codigo: 'off', motivo: 'Canasta 3x desactivada.', historial };
  }
  if (modo !== 'demo') {
    return { permitido: false, codigo: 'mode', motivo: 'La canasta 3x solo opera en cuenta demo real.', historial };
  }
  if (pendientes.length >= normalizada.basketSize) {
    return {
      permitido: false,
      codigo: 'full',
      motivo: `La canasta ya tiene ${pendientes.length}/${normalizada.basketSize} operaciones abiertas.`,
      historial,
    };
  }
  if (pendientes.some(item => item.mercadoId === mercadoId)) {
    return { permitido: false, codigo: 'duplicate_market', motivo: 'La canasta ya tiene una operación abierta en este mercado.', historial };
  }
  if (!topMarketIds.includes(mercadoId)) {
    return { permitido: false, codigo: 'not_top', motivo: 'El mercado no está dentro del top recomendado actual.', historial };
  }
  const tienePuntuacionMercado = mercadoPuntuacion !== null
    && mercadoPuntuacion !== undefined
    && mercadoPuntuacion !== '';
  if (tienePuntuacionMercado && Number.isFinite(Number(mercadoPuntuacion)) && Number(mercadoPuntuacion) < normalizada.basketMinMarketScore) {
    return {
      permitido: false,
      codigo: 'market_score',
      motivo: `Puntuación del mercado baja: ${Number(mercadoPuntuacion).toFixed(0)}/${normalizada.basketMinMarketScore}.`,
      historial,
    };
  }
  if (Number(calidad) < normalizada.basketMinQuality) {
    return {
      permitido: false,
      codigo: 'quality',
      motivo: `Calidad insuficiente para canasta: ${Number(calidad) || 0}/${normalizada.basketMinQuality}.`,
      historial,
    };
  }
  if (historial.total < normalizada.basketMinHistory) {
    return {
      permitido: false,
      codigo: 'sample',
      motivo: `Historial insuficiente: ${historial.total}/${normalizada.basketMinHistory} operaciones cerradas en demo.`,
      historial,
    };
  }
  if (historial.winRate !== null && historial.winRate < normalizada.basketMinWinRate) {
    return {
      permitido: false,
      codigo: 'win_rate',
      motivo: `Acierto histórico bajo: ${historial.winRate.toFixed(1)}%/${normalizada.basketMinWinRate}%.`,
      historial,
    };
  }

  return {
    permitido: true,
    codigo: 'ready',
    motivo: `Candidato aceptado para canasta ${pendientes.length + 1}/${normalizada.basketSize}.`,
    historial,
    pendientes: pendientes.length,
  };
}
