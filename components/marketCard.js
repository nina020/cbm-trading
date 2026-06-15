export function badgeClass(perfil) {
  if (perfil === 'alta') return 'badge-alta';
  if (perfil === 'media') return 'badge-media';
  return 'badge-estable';
}

export function badgeTexto(perfil) {
  if (perfil === 'alta') return '🔥 Alta';
  if (perfil === 'media') return '⚡ Media';
  return '✅ Estable';
}

export function createMarketCard({ id, nombre, perfil, periodo, chartTheme }) {
  const div = document.createElement('div');
  div.className = 'card';
  div.id = `card-${id}`;
  div.innerHTML = `
    <div class="card-header">
      <div style="display:flex;align-items:center;gap:6px">
        <span class="card-title">${nombre}</span>
        <span class="badge ${badgeClass(perfil)}">${badgeTexto(perfil)}</span>
      </div>
      <div class="card-meta">
        <span class="card-time">--:--:--</span>
        <button class="btn-remove" onclick="quitarMercado('${id}')">✕</button>
      </div>
    </div>
    <div class="chart-container" id="chart-${id}"></div>
    <div class="stats">
      <div class="stat"><div class="stat-label">Precio</div><div class="stat-value precio">—</div></div>
      <div class="stat"><div class="stat-label">MA (${periodo})</div><div class="stat-value ma">—</div></div>
      <div class="stat"><div class="stat-label">RSI (${periodo})</div><div class="stat-value rsi">—</div></div>
      <div class="stat"><div class="stat-label">Ticks</div><div class="stat-value ticks">0/${periodo}</div></div>
    </div>
    <div class="auto-toggle-row">
      <label class="auto-toggle-label">
        <input type="checkbox" onchange="toggleAutoMercado('${id}', this.checked)">
        🤖 Ejecutar automáticamente
      </label>
    </div>
    <div class="auto-status auto-status-off" id="auto-status-${id}">
      <div class="auto-status-reason">Automático apagado.</div>
    </div>
    <div class="signal-container"><div class="signal signal-loading">⏳ Recopilando datos...</div></div>
  `;

  document.getElementById('markets').appendChild(div);
  const container = document.getElementById(`chart-${id}`);
  const chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 200,
    layout: { background: { color: chartTheme.bg }, textColor: chartTheme.text },
    grid: { vertLines: { color: chartTheme.grid }, horzLines: { color: chartTheme.grid } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    timeScale: { timeVisible: true, secondsVisible: true, borderColor: chartTheme.border },
    rightPriceScale: { borderColor: chartTheme.border },
  });
  const candleSeries = chart.addCandlestickSeries({
    upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
    wickUpColor: '#26a69a', wickDownColor: '#ef5350',
  });
  const maSeries = chart.addLineSeries({
    color: '#f6a623', lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
  });
  window.addEventListener('resize', () => chart.applyOptions({ width: container.clientWidth }));
  return { chart, candleSeries, maSeries };
}
