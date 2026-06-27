function limitar(value, minimo, maximo) {
  return Math.min(maximo, Math.max(minimo, value));
}

function puntosPerfil(perfil) {
  if (perfil === 'estable') return 15;
  if (perfil === 'media') return 9;
  return 4;
}

function resumirHistorial(registros, mercadoId) {
  const cerradas = registros.filter(
    item => (
      item.modo === 'demo'
      && item.mercadoId === mercadoId
      && ['ganada', 'perdida'].includes(item.estado)
    ),
  );
  const ganadas = cerradas.filter(item => item.estado === 'ganada').length;
  const pnl = cerradas.reduce(
    (total, item) => total + (Number(item.pnlNeto ?? item.pnl) || 0),
    0,
  );
  return {
    total: cerradas.length,
    ganadas,
    perdidas: cerradas.length - ganadas,
    winRate: cerradas.length ? (ganadas / cerradas.length) * 100 : null,
    pnl,
  };
}

export function evaluarMercadoParaInicio({
  id,
  nombre,
  perfil,
  precio,
  desviacion,
  calidad = 0,
  calibracion = null,
  signalConfig = null,
  estrategia = null,
  registros = [],
}) {
  const precioNumero = Number(precio);
  const desviacionNumero = Number(desviacion);
  const listo = Number.isFinite(precioNumero)
    && precioNumero > 0
    && Number.isFinite(desviacionNumero);
  const volatilidadRelativa = listo ? (desviacionNumero / precioNumero) * 100 : null;
  const puntosEstabilidad = listo
    ? limitar(1 - volatilidadRelativa / 1, 0, 1) * 35
    : 0;
  const puntosCalidad = limitar(Number(calidad) || 0, 0, 100) * 0.25;
  const historial = resumirHistorial(registros, id);
  const confianzaMuestra = limitar(historial.total / 20, 0, 1);
  const puntosHistorial = historial.winRate === null
    ? 0
    : (historial.winRate / 100) * confianzaMuestra * 18;
  const puntosPnlDemo = historial.total
    ? limitar(historial.pnl / 5, -1, 1) * confianzaMuestra * 7
    : 0;
  const puntosCalibracion = calibracion ? 10 : 0;
  const umbralMinimo = Number(calibracion?.umbralMinimo ?? signalConfig?.umbralMinimo);
  const ajusteUmbral = Number.isFinite(umbralMinimo)
    ? (Number(calidad) >= umbralMinimo
      ? 5
      : -limitar((umbralMinimo - Number(calidad)) * 0.6, 0, 12))
    : 0;
  const ajusteEstrategia = estrategia
    ? (estrategia.permitido ? 3 : (estrategia.codigo === 'schedule' ? -8 : -12))
    : 0;
  const puntuacionBase = Math.round(
    puntosPerfil(perfil)
    + puntosEstabilidad
    + puntosCalidad
    + puntosHistorial
    + puntosPnlDemo
    + puntosCalibracion
    + ajusteUmbral
    + ajusteEstrategia,
  );
  const puntuacion = limitar(puntuacionBase, 0, 100);

  const nivel = !listo ? 'recopilando'
    : estrategia && !estrategia.permitido ? 'considerar'
    : puntuacion >= 75 ? 'recomendable'
    : puntuacion >= 60 ? 'considerar'
    : 'observar';

  return {
    id,
    nombre,
    perfil,
    listo,
    puntuacion,
    nivel,
    calidad: Number(calidad) || 0,
    volatilidadRelativa,
    calibrado: Boolean(calibracion),
    umbralMinimo: Number.isFinite(umbralMinimo) ? umbralMinimo : null,
    estrategia: estrategia ? {
      permitido: estrategia.permitido,
      codigo: estrategia.codigo,
      motivo: estrategia.motivo,
    } : null,
    historial,
  };
}

export function ordenarMercadosParaInicio(mercados) {
  return mercados
    .map(evaluarMercadoParaInicio)
    .sort((a, b) => Number(b.listo) - Number(a.listo) || b.puntuacion - a.puntuacion);
}
