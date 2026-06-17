function numero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function inicioPeriodo(dias, now) {
  return new Date(now.getTime() - dias * 24 * 60 * 60 * 1000);
}

function fechaCierre(registro) {
  const raw = registro.cerradaEn || registro.abiertaEn;
  const fecha = raw ? new Date(raw) : null;
  return fecha && !Number.isNaN(fecha.getTime()) ? fecha : null;
}

function agruparPor(registros, keyFn) {
  const grupos = new Map();
  registros.forEach(registro => {
    const key = keyFn(registro);
    if (!key) return;
    const actual = grupos.get(key) || {
      key,
      total: 0,
      ganadas: 0,
      perdidas: 0,
      pnl: 0,
    };
    const pnl = numero(registro.pnlNeto ?? registro.pnl);
    actual.total++;
    actual.pnl += pnl;
    if (pnl >= 0) actual.ganadas++;
    else actual.perdidas++;
    grupos.set(key, actual);
  });
  return Array.from(grupos.values())
    .map(item => ({
      ...item,
      winRate: item.total ? (item.ganadas / item.total) * 100 : 0,
    }))
    .sort((a, b) => b.pnl - a.pnl || b.total - a.total);
}

export function evaluarSemanaTrading({
  registros = [],
  now = new Date(),
  dias = 7,
} = {}) {
  const desde = inicioPeriodo(dias, now);
  const cerradas = registros
    .filter(item => item.modo === 'demo' && item.estado !== 'pendiente')
    .filter(item => {
      const fecha = fechaCierre(item);
      return fecha && fecha >= desde && fecha <= now;
    });

  const total = cerradas.length;
  const ganadas = cerradas.filter(item => numero(item.pnlNeto ?? item.pnl) >= 0).length;
  const perdidas = total - ganadas;
  const pnl = cerradas.reduce((sum, item) => sum + numero(item.pnlNeto ?? item.pnl), 0);
  const perdidaAcumulada = cerradas.reduce((sum, item) => {
    const pnlItem = numero(item.pnlNeto ?? item.pnl);
    return pnlItem < 0 ? sum + Math.abs(pnlItem) : sum;
  }, 0);
  const winRate = total ? (ganadas / total) * 100 : 0;

  const porMercado = agruparPor(cerradas, item => item.nombre || item.mercadoId);
  const porHora = agruparPor(cerradas, item => {
    const fecha = fechaCierre(item);
    if (!fecha) return null;
    const hora = fecha.getHours();
    return `${String(hora).padStart(2, '0')}:00-${String(hora + 1).padStart(2, '0')}:00`;
  });
  const peorRacha = calcularPeorRacha(cerradas);
  const maxDrawdown = calcularDrawdown(cerradas);

  return {
    dias,
    desde: desde.toISOString(),
    hasta: now.toISOString(),
    total,
    ganadas,
    perdidas,
    winRate,
    pnl,
    perdidaAcumulada,
    maxDrawdown,
    peorRacha,
    mejorMercado: porMercado[0] || null,
    peorMercado: [...porMercado].sort((a, b) => a.pnl - b.pnl || b.total - a.total)[0] || null,
    mejorHorario: porHora[0] || null,
    porMercado,
    porHora,
  };
}

function calcularPeorRacha(registros) {
  const ordenados = [...registros].sort((a, b) => fechaCierre(a) - fechaCierre(b));
  let actual = 0;
  let peor = 0;
  ordenados.forEach(item => {
    const pnl = numero(item.pnlNeto ?? item.pnl);
    if (pnl < 0) {
      actual++;
      peor = Math.max(peor, actual);
    } else {
      actual = 0;
    }
  });
  return peor;
}

function calcularDrawdown(registros) {
  const ordenados = [...registros].sort((a, b) => fechaCierre(a) - fechaCierre(b));
  let equity = 0;
  let pico = 0;
  let drawdown = 0;
  ordenados.forEach(item => {
    equity += numero(item.pnlNeto ?? item.pnl);
    pico = Math.max(pico, equity);
    drawdown = Math.max(drawdown, pico - equity);
  });
  return drawdown;
}

export function evaluarPreparacionReal({
  evaluacion,
  registros = [],
  configRiesgo = {},
} = {}) {
  const demoCerradas = registros.filter(item => item.modo === 'demo' && item.estado !== 'pendiente');
  const checks = [
    {
      id: 'muestra',
      label: 'Mínimo 50 operaciones demo cerradas',
      ok: demoCerradas.length >= 50,
      detalle: `${demoCerradas.length}/50`,
    },
    {
      id: 'winrate',
      label: 'Win rate semanal mínimo 55%',
      ok: evaluacion.winRate >= 55,
      detalle: `${evaluacion.winRate.toFixed(1)}%`,
    },
    {
      id: 'pnl',
      label: 'P&L semanal positivo',
      ok: evaluacion.pnl > 0,
      detalle: `$${evaluacion.pnl.toFixed(2)}`,
    },
    {
      id: 'racha',
      label: 'Pérdidas consecutivas controladas',
      ok: evaluacion.peorRacha <= 2,
      detalle: `${evaluacion.peorRacha} seguidas`,
    },
    {
      id: 'riesgo',
      label: 'Límite diario de pérdida configurado',
      ok: Number(configRiesgo.perdidaMaximaDiaria) > 0,
      detalle: `$${Number(configRiesgo.perdidaMaximaDiaria || 0).toFixed(2)}`,
    },
  ];
  const aprobadas = checks.filter(item => item.ok).length;
  const listo = checks.every(item => item.ok);
  return {
    listo,
    aprobadas,
    total: checks.length,
    estado: listo ? 'Listo para prueba controlada' : 'Aún no listo para dinero real',
    checks,
  };
}
