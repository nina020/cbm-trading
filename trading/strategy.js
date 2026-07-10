import { SL_DESVIACIONES, TP_DESVIACIONES } from '../config.js';

export function calcularMA(precios) {
  return precios.reduce((total, precio) => total + precio, 0) / precios.length;
}

export function calcularRSI(precios) {
  let ganancias = 0;
  let perdidas = 0;
  for (let i = 1; i < precios.length; i++) {
    const diferencia = precios[i] - precios[i - 1];
    if (diferencia >= 0) ganancias += diferencia;
    else perdidas += Math.abs(diferencia);
  }
  const rs = ganancias / (perdidas || 1);
  return (100 - 100 / (1 + rs)).toFixed(2);
}

export function calcularDesviacion(precios, media) {
  const varianza = precios.reduce(
    (total, precio) => total + Math.pow(precio - media, 2),
    0,
  ) / precios.length;
  return Math.sqrt(varianza);
}

export function evaluarSenal({ precio, ma, rsi, desviacion }) {
  if (precio > ma && rsi < 70) {
    return {
      tipo: 'BUY',
      sl: precio - desviacion * SL_DESVIACIONES,
      tp: precio + desviacion * TP_DESVIACIONES,
    };
  }
  if (precio < ma && rsi > 30) {
    return {
      tipo: 'SELL',
      sl: precio + desviacion * SL_DESVIACIONES,
      tp: precio - desviacion * TP_DESVIACIONES,
    };
  }
  return { tipo: 'WAIT', sl: null, tp: null };
}
