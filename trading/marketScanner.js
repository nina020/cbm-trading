import {
  calcularMA, calcularRSI, calcularDesviacion, calcularEMA,
  evaluarSenal, detectarSoporteResistencia, clasificarTendencia, detectarRango,
} from './strategy.js';
import { puntuarSenal } from './signalScorer.js';
import { PERIODO_EMA } from '../config.js';

export function analizarMercadoHistorico({ mercado, ticks, periodo = 14 }) {
  const preciosDisponibles = ticks
    .map(tick => Number(tick.precio))
    .filter(Number.isFinite);
  const precios = preciosDisponibles.slice(-periodo);

  if (precios.length < periodo) {
    throw new Error(`Muestra insuficiente para ${mercado.nombre}`);
  }

  const precio = precios[precios.length - 1];
  const media = calcularMA(precios);
  const historialRsi = preciosDisponibles.slice(-periodo * 5);
  const rsi = calcularRSI(historialRsi, periodo);
  const desviacion = calcularDesviacion(precios, media);
  const { soporte, resistencia } = detectarSoporteResistencia(preciosDisponibles);
  const tendencia = clasificarTendencia(preciosDisponibles, PERIODO_EMA);
  const { enRango } = detectarRango(precios, rsi, soporte, resistencia);
  const senal = evaluarSenal({ precio, ma: media, rsi, desviacion, soporte, resistencia, tendencia, enRango });
  const calidad = puntuarSenal({
    tipo: senal.tipo,
    precio,
    ma: media,
    rsi,
    desviacion,
    precios,
  });

  return {
    ...mercado,
    precio,
    desviacion,
    calidad: calidad.puntuacion,
    tipoSenal: senal.tipo,
    tendencia,
    enRango,
  };
}

export async function escanearMercadosEstables({
  mercados,
  obtenerTicks,
  periodo = 14,
  cantidadTicks = 120,
  concurrencia = 3,
}) {
  const resultados = [];

  for (let indice = 0; indice < mercados.length; indice += concurrencia) {
    const lote = mercados.slice(indice, indice + concurrencia);
    const respuestas = await Promise.allSettled(lote.map(async mercado => {
      const ticks = await obtenerTicks(mercado.id, cantidadTicks);
      return analizarMercadoHistorico({ mercado, ticks, periodo });
    }));

    respuestas.forEach(respuesta => {
      if (respuesta.status === 'fulfilled') resultados.push(respuesta.value);
    });
  }

  return resultados;
}
