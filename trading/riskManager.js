import { FRACCION_RIESGO_STAKE, RATIO_RECOMPENSA } from '../config.js';

/**
 * Billy Chacón (Módulo 5): rango de riesgo recomendado según el tamaño de cuenta.
 * $100–$200 → 3-5% por operación (cuenta pequeña, más agresivo).
 * $200–$500 → 2-3%.
 * $500+ → 1-2% (proteger ganancias acumuladas).
 */
export function rangoRiesgoRecomendado(saldo) {
  const s = Number(saldo) || 0;
  if (s <= 0) return null;
  if (s <= 200) return { min: 3, max: 5, texto: '3–5% (cuenta pequeña)' };
  if (s <= 500) return { min: 2, max: 3, texto: '2–3% (cuenta media)' };
  return { min: 1, max: 2, texto: '1–2% (cuenta avanzada)' };
}

export function calcularObjetivosMonetarios(stake) {
  const inversion = Number(stake) || 0;
  const riesgo = inversion * FRACCION_RIESGO_STAKE;
  return {
    inversion,
    riesgo,
    objetivo: riesgo * RATIO_RECOMPENSA,
  };
}

export function createRiskManager({ saldoInicial = 10000 } = {}) {
  let modo = 'fijo';
  let porcentaje = 1;
  let montoFijo = 1;
  let saldo = saldoInicial;

  return {
    setSaldo(value) { saldo = Number(value) || 0; },
    setModo(value) { modo = value === 'fijo' ? 'fijo' : 'porcentaje'; },
    setPorcentaje(value) { porcentaje = Number(value) || 1; },
    setMontoFijo(value) { montoFijo = Number(value) || 1; },
    calcularInversion() {
      return modo === 'fijo' ? montoFijo : saldo * (porcentaje / 100);
    },
    etiqueta() {
      return modo === 'fijo' ? 'Monto fijo' : `${porcentaje}% del saldo demo`;
    },
    get modo() { return modo; },
  };
}
