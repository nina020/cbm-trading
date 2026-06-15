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
    item => item.mercadoId === mercadoId && item.estado !== 'pendiente',
  );
  const ganadas = cerradas.filter(item => item.estado === 'ganada').length;
  return {
    total: cerradas.length,
    winRate: cerradas.length ? (ganadas / cerradas.length) * 100 : null,
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
    : (historial.winRate / 100) * confianzaMuestra * 15;
  const puntosCalibracion = calibracion ? 10 : 0;
  const puntuacion = Math.round(
    puntosPerfil(perfil)
    + puntosEstabilidad
    + puntosCalidad
    + puntosHistorial
    + puntosCalibracion,
  );

  const nivel = !listo ? 'recopilando'
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
    historial,
  };
}

export function ordenarMercadosParaInicio(mercados) {
  return mercados
    .map(evaluarMercadoParaInicio)
    .sort((a, b) => Number(b.listo) - Number(a.listo) || b.puntuacion - a.puntuacion);
}
