export const STRATEGY_CONFIG_DEFAULTS = {
  usarHorario: true,
  horaInicio: '08:00',
  horaFin: '17:00',
  diasPermitidos: [1, 2, 3, 4, 5],
  notificarFueraHorario: true,
  maxOperacionesHora: 3,
  maxOperacionesDia: 10,
};

function limitar(value, minimo, maximo) {
  return Math.min(maximo, Math.max(minimo, value));
}

function normalizarHora(value, fallback) {
  const texto = String(value || '').trim();
  return /^\d{2}:\d{2}$/.test(texto) ? texto : fallback;
}

function minutosDelDia(value) {
  const [horas, minutos] = String(value).split(':').map(Number);
  return horas * 60 + minutos;
}

function obtenerFecha(value) {
  return value instanceof Date ? value : new Date(value);
}

function mismoDia(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

export function normalizarStrategyConfig(config = {}) {
  const dias = Array.isArray(config.diasPermitidos)
    ? config.diasPermitidos.map(Number).filter(dia => dia >= 0 && dia <= 6)
    : STRATEGY_CONFIG_DEFAULTS.diasPermitidos;

  return {
    usarHorario: config.usarHorario !== false,
    horaInicio: normalizarHora(config.horaInicio, STRATEGY_CONFIG_DEFAULTS.horaInicio),
    horaFin: normalizarHora(config.horaFin, STRATEGY_CONFIG_DEFAULTS.horaFin),
    diasPermitidos: dias.length ? [...new Set(dias)] : STRATEGY_CONFIG_DEFAULTS.diasPermitidos,
    notificarFueraHorario: config.notificarFueraHorario !== false,
    maxOperacionesHora: limitar(
      Math.round(Number(config.maxOperacionesHora) || STRATEGY_CONFIG_DEFAULTS.maxOperacionesHora),
      1,
      100,
    ),
    maxOperacionesDia: limitar(
      Math.round(Number(config.maxOperacionesDia) || STRATEGY_CONFIG_DEFAULTS.maxOperacionesDia),
      1,
      500,
    ),
  };
}

export function estaDentroDeHorario(config, fecha = new Date()) {
  const cfg = normalizarStrategyConfig(config);
  if (!cfg.usarHorario) return true;

  const actual = obtenerFecha(fecha);
  if (!cfg.diasPermitidos.includes(actual.getDay())) return false;

  const minutoActual = actual.getHours() * 60 + actual.getMinutes();
  const inicio = minutosDelDia(cfg.horaInicio);
  const fin = minutosDelDia(cfg.horaFin);

  if (inicio === fin) return true;
  if (inicio < fin) return minutoActual >= inicio && minutoActual <= fin;
  return minutoActual >= inicio || minutoActual <= fin;
}

export function contarOperacionesAutomaticas(registros = [], fecha = new Date()) {
  const ahora = obtenerFecha(fecha);
  const inicioHora = ahora.getTime() - 60 * 60 * 1000;

  return registros.reduce((resumen, item) => {
    if (item?.origen !== 'automatica' || !item.abiertaEn) return resumen;
    const abierta = new Date(item.abiertaEn);
    if (Number.isNaN(abierta.getTime())) return resumen;
    if (mismoDia(abierta, ahora)) resumen.dia++;
    if (abierta.getTime() >= inicioHora && abierta.getTime() <= ahora.getTime()) resumen.hora++;
    return resumen;
  }, { hora: 0, dia: 0 });
}

export function evaluarReglasEstrategia({
  config,
  registros = [],
  fecha = new Date(),
} = {}) {
  const cfg = normalizarStrategyConfig(config);
  const dentroHorario = estaDentroDeHorario(cfg, fecha);
  const conteo = contarOperacionesAutomaticas(registros, fecha);

  if (!dentroHorario) {
    return {
      permitido: false,
      codigo: 'schedule',
      motivo: `Fuera del horario permitido (${cfg.horaInicio}-${cfg.horaFin}).`,
      dentroHorario,
      conteo,
    };
  }
  if (conteo.hora >= cfg.maxOperacionesHora) {
    return {
      permitido: false,
      codigo: 'frequency',
      motivo: `Límite por hora alcanzado (${conteo.hora}/${cfg.maxOperacionesHora}).`,
      dentroHorario,
      conteo,
    };
  }
  if (conteo.dia >= cfg.maxOperacionesDia) {
    return {
      permitido: false,
      codigo: 'frequency',
      motivo: `Límite diario alcanzado (${conteo.dia}/${cfg.maxOperacionesDia}).`,
      dentroHorario,
      conteo,
    };
  }

  return {
    permitido: true,
    codigo: 'ready',
    motivo: 'Dentro de horario y frecuencia permitida.',
    dentroHorario,
    conteo,
  };
}
