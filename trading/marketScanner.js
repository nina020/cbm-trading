import {
  calcularMA, calcularRSI, calcularDesviacion, evaluarSenal,
} from './strategy.js';
import { puntuarSenal } from './signalScorer.js';

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
  const rsi = calcularRSI(precios);
  const desviacion = calcularDesviacion(precios, media);
  const senal = evaluarSenal({ precio, ma: media, rsi, desviacion });
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
