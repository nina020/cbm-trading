export const GLOBAL_RISK_DEFAULTS = {
  perdidaMaximaDiaria: 100,
  maxPosicionesAbiertas: 3,
  maxPerdidasConsecutivas: 3,
  pausaMinutos: 30,
};

function limitarNumero(value, fallback, minimo, maximo) {
  const numero = Number(value);
  if (!Number.isFinite(numero)) return fallback;
  return Math.min(maximo, Math.max(minimo, numero));
}

export function normalizarGlobalRiskConfig(config = {}) {
  return {
    perdidaMaximaDiaria: limitarNumero(
      config.perdidaMaximaDiaria,
      GLOBAL_RISK_DEFAULTS.perdidaMaximaDiaria,
      1,
      100000,
    ),
    maxPosicionesAbiertas: Math.round(limitarNumero(
      config.maxPosicionesAbiertas,
      GLOBAL_RISK_DEFAULTS.maxPosicionesAbiertas,
      1,
      50,
    )),
    maxPerdidasConsecutivas: Math.round(limitarNumero(
      config.maxPerdidasConsecutivas,
      GLOBAL_RISK_DEFAULTS.maxPerdidasConsecutivas,
      1,
      20,
    )),
    pausaMinutos: Math.round(limitarNumero(
      config.pausaMinutos,
      GLOBAL_RISK_DEFAULTS.pausaMinutos,
      1,
      1440,
    )),
  };
}

function esDeHoy(fecha, ahora) {
  if (!fecha) return false;
  return new Date(fecha).toDateString() === new Date(ahora).toDateString();
}

export function resumirRiesgoDiario(registros, ahora = Date.now()) {
  const cerradasHoy = registros
    .filter(item => item.estado !== 'pendiente' && esDeHoy(item.cerradaEn, ahora))
    .sort((a, b) => new Date(b.cerradaEn) - new Date(a.cerradaEn));
  const perdidaDiaria = cerradasHoy.reduce((total, item) => {
    const pnl = Number(item.pnlNeto ?? item.pnl) || 0;
    return pnl < 0 ? total + Math.abs(pnl) : total;
  }, 0);
  let perdidasConsecutivas = 0;
  for (const item of cerradasHoy) {
    const pnl = Number(item.pnlNeto ?? item.pnl) || 0;
    if (pnl >= 0) break;
    perdidasConsecutivas++;
  }

  return {
    perdidaDiaria,
    perdidasConsecutivas,
    posicionesAbiertas: registros.filter(item => item.estado === 'pendiente').length,
  };
}

export function createGlobalRiskManager({
  storageKey,
  storage = localStorage,
  getNow = () => Date.now(),
} = {}) {
  let config = { ...GLOBAL_RISK_DEFAULTS };
  let pausaHasta = 0;

  function guardar() {
    storage?.setItem(storageKey, JSON.stringify({ config, pausaHasta }));
  }

  return {
    cargar() {
      try {
        const data = JSON.parse(storage?.getItem(storageKey) || '{}');
        config = normalizarGlobalRiskConfig(data.config);
        pausaHasta = Number(data.pausaHasta) || 0;
      } catch (error) {
        config = { ...GLOBAL_RISK_DEFAULTS };
        pausaHasta = 0;
      }
      return this.estado([]);
    },
    configurar(nuevaConfig) {
      config = normalizarGlobalRiskConfig(nuevaConfig);
      guardar();
      return { ...config };
    },
    reanudar() {
      pausaHasta = 0;
      guardar();
    },
    evaluar({ registros = [], riesgoOperacion = 0 } = {}) {
      const ahora = getNow();
      const resumen = resumirRiesgoDiario(registros, ahora);
      const riesgo = Math.max(0, Number(riesgoOperacion) || 0);

      if (pausaHasta > ahora) {
        return {
          permitido: false,
          codigo: 'pausa',
          motivo: `Operativa pausada hasta ${new Date(pausaHasta).toLocaleTimeString()}.`,
          ...resumen,
        };
      }

      if (resumen.perdidasConsecutivas >= config.maxPerdidasConsecutivas) {
        pausaHasta = ahora + config.pausaMinutos * 60000;
        guardar();
        return {
          permitido: false,
          codigo: 'perdidas_consecutivas',
          motivo: `Pausa automática por ${resumen.perdidasConsecutivas} pérdidas consecutivas.`,
          ...resumen,
        };
      }

      if (resumen.posicionesAbiertas >= config.maxPosicionesAbiertas) {
        return {
          permitido: false,
          codigo: 'max_posiciones',
          motivo: `Límite de ${config.maxPosicionesAbiertas} posiciones abiertas alcanzado.`,
          ...resumen,
        };
      }

      if (resumen.perdidaDiaria + riesgo > config.perdidaMaximaDiaria) {
        return {
          permitido: false,
          codigo: 'perdida_diaria',
          motivo: `La operación superaría la pérdida diaria máxima de $${config.perdidaMaximaDiaria.toFixed(2)}.`,
          ...resumen,
        };
      }

      return { permitido: true, codigo: 'ok', motivo: 'Riesgo disponible.', ...resumen };
    },
    estado(registros = []) {
      const ahora = getNow();
      return {
        config: { ...config },
        pausaHasta,
        pausado: pausaHasta > ahora,
        ...resumirRiesgoDiario(registros, ahora),
      };
    },
  };
}
