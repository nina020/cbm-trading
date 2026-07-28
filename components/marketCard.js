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
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span class="card-title">${nombre}</span>
        <span class="badge ${badgeClass(perfil)}">${badgeTexto(perfil)}</span>
        <!-- Cambio #9: badge de tendencia prominente -->
        <span id="tendencia-badge-${id}" style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--bg-stat);color:var(--text-secondary);border:1px solid var(--border)">— tendencia</span>
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
      <!-- Cambio #1: EMA 200 visible como stat -->
      <div class="stat"><div class="stat-label">EMA 200</div><div class="stat-value ema200" title="Media Móvil Exponencial de 200 periodos — filtro de tendencia principal">—</div></div>
      <div class="stat"><div class="stat-label">Velas</div><div class="stat-value ticks">0/${periodo}</div></div>
    </div>
    <!-- Cambio #3: Panel de las 4 confirmaciones obligatorias (Billy Chacón, Módulo 5) -->
    <div id="checklist-${id}" style="display:none;margin:6px 0;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-stat)">
      <div style="font-size:10px;font-weight:700;color:var(--text-faint);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Checklist entrada · 4 confirmaciones</div>
      <div id="checklist-items-${id}" style="display:grid;grid-template-columns:1fr 1fr;gap:4px"></div>
      <div id="checklist-total-${id}" style="margin-top:5px;font-size:10px;text-align:right;color:var(--text-faint)"></div>
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
    <div class="signal-container"><div class="signal signal-loading">⏳ Acumulando velas (0/${periodo})...</div></div>
  `;

  document.getElementById('markets').appendChild(div);
  const container = document.getElementById(`chart-${id}`);
  const chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight || 200,
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
  // MA simple — línea naranja
  const maSeries = chart.addLineSeries({
    color: '#f6a623', lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
  });
  // Cambio #1: EMA 200 — línea azul discontinua para distinguirla de la MA simple.
  // Billy Chacón (Módulo 2): precio > EMA 200 = buscar compras; precio < EMA 200 = buscar ventas.
  const emaSeries = chart.addLineSeries({
    color: '#2a78d6',
    lineWidth: 2,
    lineStyle: 2,           // 2 = Dashed en lightweight-charts
    priceLineVisible: false,
    lastValueVisible: true,
    title: 'EMA 200',
  });
  window.addEventListener('resize', () => chart.applyOptions({
    width: container.clientWidth,
    height: container.clientHeight || 200,
  }));
  // srLines almacena las price lines de S/R activas para poder quitarlas al actualizar.
  const srLines = { soporte: null, resistencia: null };
  return { chart, candleSeries, maSeries, emaSeries, srLines };
}
