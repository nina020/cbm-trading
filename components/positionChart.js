import { calcularMA } from '../trading/strategy.js';

export function crearMediaMovil(ticks, periodo) {
  return ticks.slice(periodo - 1).map((tick, index) => ({
    time: tick.epoch,
    value: calcularMA(
      ticks.slice(index, index + periodo).map(item => item.precio),
    ),
  }));
}

export function createPositionChart({ contenedor, ticks, chartTheme, periodo = 14 }) {
  const chart = LightweightCharts.createChart(contenedor, {
    width: contenedor.clientWidth,
    height: 260,
    layout: { background: { color: chartTheme.bg }, textColor: chartTheme.text },
    grid: {
      vertLines: { color: chartTheme.grid },
      horzLines: { color: chartTheme.grid },
    },
    timeScale: {
      timeVisible: true,
      secondsVisible: true,
      borderColor: chartTheme.border,
    },
    rightPriceScale: { borderColor: chartTheme.border },
  });
  const priceSeries = chart.addLineSeries({
    color: '#2962ff',
    lineWidth: 2,
    priceLineVisible: true,
  });
  const maSeries = chart.addLineSeries({
    color: '#f6a623',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: true,
  });

  priceSeries.setData(ticks.map(tick => ({
    time: tick.epoch,
    value: tick.precio,
  })));
  maSeries.setData(crearMediaMovil(ticks, periodo));
  chart.timeScale().fitContent();

  return {
    chart,
    update(nuevosTicks) {
      priceSeries.setData(nuevosTicks.map(tick => ({
        time: tick.epoch,
        value: tick.precio,
      })));
      maSeries.setData(crearMediaMovil(nuevosTicks, periodo));
    },
    remove() {
      chart.remove();
    },
  };
}
