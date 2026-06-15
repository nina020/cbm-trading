import { RATIO_RECOMPENSA } from '../config.js';
import { calcularObjetivosMonetarios, evaluarSalidaPorPrecio } from './riskManager.js';
import { calcularMA, calcularRSI, calcularDesviacion, evaluarSenal } from './strategy.js';
import { createSignalTrigger, puntuarSenal } from './signalScorer.js';
import { recomendarCalibracion } from './marketCalibration.js';

function calcularDrawdown(curva) {
  let pico = curva[0] || 0;
  let maximo = 0;
  for (const valor of curva) {
    pico = Math.max(pico, valor);
    maximo = Math.max(maximo, pico - valor);
  }
  return maximo;
}

export function ejecutarBacktest({
  ticks,
  periodo,
  stake,
  saldoInicial = 10000,
  ratioRecompensa = RATIO_RECOMPENSA,
  umbralMinimo = null,
  confirmacionesRequeridas = 1,
}) {
  const operaciones = [];
  const precios = [];
  const curvaCapital = [saldoInicial];
  let capital = saldoInicial;
  let posicion = null;
  const signalTrigger = createSignalTrigger();
  const { riesgo: riesgoMonetario } = calcularObjetivosMonetarios(stake);

  for (const tick of ticks) {
    precios.push(tick.precio);
    if (precios.length > periodo) precios.shift();

    if (posicion) {
      const salida = evaluarSalidaPorPrecio({
        ...posicion,
        precio: tick.precio,
      });

      if (salida) {
        const gano = salida === 'take_profit';
        const pnl = gano ? riesgoMonetario * ratioRecompensa : -riesgoMonetario;
        capital += pnl;
        operaciones.push({
          ...posicion,
          salida: tick.precio,
          salidaEpoch: tick.epoch,
          resultado: gano ? 'ganada' : 'perdida',
          pnl,
          capital,
        });
        curvaCapital.push(capital);
        posicion = null;
      }
    }

    if (precios.length < periodo) continue;

    const ma = calcularMA(precios);
    const rsi = Number(calcularRSI(precios));
    const desviacion = calcularDesviacion(precios, ma);
    const senal = evaluarSenal({ precio: tick.precio, ma, rsi, desviacion });
    const calidad = puntuarSenal({
      tipo: senal.tipo,
      precio: tick.precio,
      ma,
      rsi,
      desviacion,
      precios,
    });
    const disparo = signalTrigger.evaluar({
      tipo: senal.tipo,
      puntuacion: calidad.puntuacion,
      activo: true,
      config: {
        umbralMinimo: umbralMinimo ?? 0,
        confirmacionesRequeridas,
        filtrarAutoTrading: umbralMinimo !== null,
      },
    });

    if (!posicion && disparo.ejecutar && desviacion > 0) {
      posicion = {
        tipo: senal.tipo,
        entrada: tick.precio,
        entradaEpoch: tick.epoch,
        sl: senal.sl,
        tp: senal.tp,
        stake,
        calidad: calidad.puntuacion,
      };
    }
  }

  const ganadas = operaciones.filter(op => op.resultado === 'ganada').length;
  const perdidas = operaciones.length - ganadas;
  const pnl = capital - saldoInicial;
  const maxDrawdown = calcularDrawdown(curvaCapital);

  return {
    totalTicks: ticks.length,
    operaciones,
    pendientes: posicion ? 1 : 0,
    total: operaciones.length,
    ganadas,
    perdidas,
    winRate: operaciones.length ? (ganadas / operaciones.length) * 100 : 0,
    pnl,
    retorno: saldoInicial ? (pnl / saldoInicial) * 100 : 0,
    saldoFinal: capital,
    maxDrawdown,
    maxDrawdownPct: saldoInicial ? (maxDrawdown / saldoInicial) * 100 : 0,
    umbralMinimo,
    confirmacionesRequeridas,
  };
}

export function resumirCalidad(operaciones) {
  const rangos = [
    { etiqueta: '<70', desde: 0, hasta: 69 },
    { etiqueta: '70–79', desde: 70, hasta: 79 },
    { etiqueta: '80–89', desde: 80, hasta: 89 },
    { etiqueta: '90–100', desde: 90, hasta: 100 },
  ];

  return rangos.map(rango => {
    const grupo = operaciones.filter(
      operacion => operacion.calidad >= rango.desde && operacion.calidad <= rango.hasta,
    );
    const ganadas = grupo.filter(operacion => operacion.resultado === 'ganada').length;
    const pnl = grupo.reduce((total, operacion) => total + operacion.pnl, 0);
    return {
      etiqueta: rango.etiqueta,
      total: grupo.length,
      ganadas,
      perdidas: grupo.length - ganadas,
      winRate: grupo.length ? (ganadas / grupo.length) * 100 : 0,
      pnl,
    };
  });
}

export function ejecutarComparativaBacktest({
  ticks,
  periodo,
  stake,
  saldoInicial = 10000,
  confirmacionesRequeridas = 3,
  umbralSeleccionado = 70,
}) {
  const umbrales = [null, 70, 80, 90];
  const comparativa = umbrales.map(umbral => ejecutarBacktest({
    ticks,
    periodo,
    stake,
    saldoInicial,
    umbralMinimo: umbral,
    confirmacionesRequeridas: umbral === null ? 1 : confirmacionesRequeridas,
  }));
  const resultado = ejecutarBacktest({
    ticks,
    periodo,
    stake,
    saldoInicial,
    umbralMinimo: umbralSeleccionado,
    confirmacionesRequeridas,
  });

  return {
    ...resultado,
    comparativa,
    calidad: resumirCalidad(comparativa[0].operaciones),
    recomendacion: recomendarCalibracion(comparativa, {
      confirmacionesRequeridas,
    }),
  };
}
