function dinero(valor) {
  const signo = valor >= 0 ? '+' : '-';
  return `${signo}$${Math.abs(valor).toFixed(2)}`;
}

export function renderBacktestResults(contenedor, resultado) {
  const pnlColor = resultado.pnl >= 0 ? '#26a69a' : '#ef5350';
  const filasComparativa = resultado.comparativa.map(item => `
    <tr>
      <td>${item.umbralMinimo === null ? 'Sin filtro' : `≥ ${item.umbralMinimo}`}</td>
      <td>${item.total}</td>
      <td>${item.winRate.toFixed(1)}%</td>
      <td style="color:${item.pnl >= 0 ? '#26a69a' : '#ef5350'}">${dinero(item.pnl)}</td>
      <td>$${item.maxDrawdown.toFixed(2)}</td>
    </tr>
  `).join('');
  const filasCalidad = resultado.calidad.map(item => `
    <tr>
      <td>${item.etiqueta}</td>
      <td>${item.total}</td>
      <td>${item.ganadas}</td>
      <td>${item.perdidas}</td>
      <td>${item.winRate.toFixed(1)}%</td>
      <td style="color:${item.pnl >= 0 ? '#26a69a' : '#ef5350'}">${dinero(item.pnl)}</td>
    </tr>
  `).join('');
  const recomendacion = resultado.recomendacion.disponible
    ? `
      <div class="calibration-recommendation">
        <div>
          <strong>Calibración recomendada para ${resultado.mercadoNombre}</strong>
          <div>Umbral ≥ ${resultado.recomendacion.umbralMinimo} · ${resultado.recomendacion.confirmacionesRequeridas} confirmaciones · ${resultado.recomendacion.total} operaciones · ${resultado.recomendacion.winRate.toFixed(1)}% aciertos</div>
          ${resultado.recomendacion.advertencia ? `<small>${resultado.recomendacion.advertencia}</small>` : ''}
        </div>
        <button class="btn-add" onclick="aplicarCalibracionBacktest()">Aplicar a este mercado</button>
      </div>
    `
    : `<div class="calibration-recommendation"><span>Sin recomendación: ${resultado.recomendacion.motivo}</span></div>`;
  contenedor.innerHTML = `
    <div class="backtest-metrics">
      <div class="summary-stat"><div class="summary-stat-label">Operaciones</div><div class="summary-stat-value">${resultado.total}</div></div>
      <div class="summary-stat"><div class="summary-stat-label">Win rate</div><div class="summary-stat-value">${resultado.winRate.toFixed(1)}%</div></div>
      <div class="summary-stat"><div class="summary-stat-label">P&L</div><div class="summary-stat-value" style="color:${pnlColor}">${dinero(resultado.pnl)}</div></div>
      <div class="summary-stat"><div class="summary-stat-label">Retorno</div><div class="summary-stat-value">${resultado.retorno.toFixed(2)}%</div></div>
      <div class="summary-stat"><div class="summary-stat-label">Drawdown máx.</div><div class="summary-stat-value" style="color:#ef5350">$${resultado.maxDrawdown.toFixed(2)}</div></div>
      <div class="summary-stat"><div class="summary-stat-label">Saldo final</div><div class="summary-stat-value">$${resultado.saldoFinal.toFixed(2)}</div></div>
    </div>
    <div class="backtest-note">
      ${resultado.ganadas} ganadas · ${resultado.perdidas} perdidas · ${resultado.totalTicks} ticks analizados
      · Umbral ${resultado.umbralMinimo}/100 · ${resultado.confirmacionesRequeridas} confirmaciones
      ${resultado.pendientes ? ' · 1 operación quedó abierta al finalizar la muestra' : ''}
    </div>
    ${recomendacion}
    <div class="backtest-section-title">Comparación de umbrales</div>
    <div class="history-table-wrap">
      <table class="history-table backtest-table">
        <thead><tr><th>Filtro</th><th>Operaciones</th><th>Win rate</th><th>P&L</th><th>Drawdown</th></tr></thead>
        <tbody>${filasComparativa}</tbody>
      </table>
    </div>
    <div class="backtest-section-title">Resultado por calidad de entrada</div>
    <div class="history-table-wrap">
      <table class="history-table backtest-table">
        <thead><tr><th>Calidad</th><th>Operaciones</th><th>Ganadas</th><th>Perdidas</th><th>Win rate</th><th>P&L</th></tr></thead>
        <tbody>${filasCalidad}</tbody>
      </table>
    </div>
  `;
}

export function renderBacktestLoading(contenedor, mensaje = 'Cargando históricos y ejecutando estrategia...') {
  contenedor.innerHTML = `<div class="positions-empty">${mensaje}</div>`;
}

export function renderBacktestError(contenedor, mensaje) {
  contenedor.innerHTML = `<div class="positions-empty" style="color:#ef5350">Error: ${mensaje}</div>`;
}
