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

export function evaluarSalidaPorPrecio({ tipo, entrada, precio, sl, tp }) {
  const entradaNumero = Number(entrada);
  const precioNumero = Number(precio);
  const slNumero = Number(sl);
  const tpNumero = Number(tp);
  const esSell = tipo === 'SELL';

  if (![entradaNumero, precioNumero, slNumero, tpNumero].every(Number.isFinite)) return null;

  const nivelesValidos = esSell
    ? tpNumero < entradaNumero && slNumero > entradaNumero
    : slNumero < entradaNumero && tpNumero > entradaNumero;
  if (!nivelesValidos) return null;

  if (esSell) {
    if (precioNumero <= tpNumero) return 'take_profit';
    if (precioNumero >= slNumero) return 'stop_loss';
  } else {
    if (precioNumero >= tpNumero) return 'take_profit';
    if (precioNumero <= slNumero) return 'stop_loss';
  }

  return null;
}

export function calcularPnlSimulado({ stake, tipo, entrada, precio, sl, tp }) {
  const entradaNumero = Number(entrada);
  const precioNumero = Number(precio);
  const slNumero = Number(sl);
  const tpNumero = Number(tp);
  const direccion = tipo === 'SELL' ? -1 : 1;
  const movimiento = (precioNumero - entradaNumero) * direccion;
  const distanciaTp = (tpNumero - entradaNumero) * direccion;
  const distanciaSl = (entradaNumero - slNumero) * direccion;
  const { riesgo, objetivo } = calcularObjetivosMonetarios(stake);

  if (![entradaNumero, precioNumero, slNumero, tpNumero].every(Number.isFinite)) return 0;

  if (movimiento >= 0) {
    if (!(distanciaTp > 0)) return 0;
    return Math.min(objetivo, (movimiento / distanciaTp) * objetivo);
  }

  if (!(distanciaSl > 0)) return 0;
  return Math.max(-riesgo, (movimiento / distanciaSl) * riesgo);
}

export function createRiskManager({ saldoInicial = 10000 } = {}) {
  let modo = 'porcentaje';
  let porcentaje = 1;
  let montoFijo = 10;
  let saldo = saldoInicial;

  return {
    setSaldo(value) { saldo = Number(value) || 0; },
    setModo(value) { modo = value === 'fijo' ? 'fijo' : 'porcentaje'; },
    setPorcentaje(value) { porcentaje = Number(value) || 1; },
    setMontoFijo(value) { montoFijo = Number(value) || 10; },
    calcularInversion() {
      return modo === 'fijo' ? montoFijo : saldo * (porcentaje / 100);
    },
    etiqueta() {
      return modo === 'fijo' ? 'Monto fijo' : `${porcentaje}% del saldo demo`;
    },
    get modo() { return modo; },
  };
}
