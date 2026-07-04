import { FRACCION_RIESGO_STAKE, RATIO_RECOMPENSA } from '../config.js';

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
