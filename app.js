import {
  INTERVALO_VELA, MAX_HISTORIAL_VISIBLE, RATIO_RECOMPENSA, MULTIPLICADOR_DEFAULT,
  STORAGE_KEY, SIM_STORAGE_KEY,
  EXECUTION_STORAGE_KEY, SIGNAL_CONFIG_STORAGE_KEY, MARKET_CALIBRATION_STORAGE_KEY,
  GLOBAL_RISK_STORAGE_KEY, NOMBRES_SIMBOLOS, MERCADOS_ESTABLES, TEMAS,
} from './config.js';
import { obtenerCuenta, obtenerWsUrl } from './services/derivApi.js';
import { obtenerTicksHistoricos } from './services/historicalDataService.js';
import {
  crearWebSocket, suscribirTicks, solicitarPortfolio, suscribirContrato,
  cerrarContrato,
} from './services/websocketService.js';
import {
  createRiskManager, calcularObjetivosMonetarios, evaluarSalidaPorPrecio,
} from './trading/riskManager.js';
import { createSimulationEngine } from './trading/simulationEngine.js';
import { createAutoTrader } from './trading/autoTrader.js';
import { createExecutionJournal } from './trading/executionJournal.js';
import { ejecutarOrdenDemo, extraerCostosReportados } from './trading/orderService.js';
import { calcularMA, calcularRSI, calcularDesviacion, evaluarSenal } from './trading/strategy.js';
import {
  SIGNAL_CONFIG_DEFAULTS, createSignalTrigger, normalizarSignalConfig, puntuarSenal,
} from './trading/signalScorer.js';
import { createMarketCalibrationStore } from './trading/marketCalibration.js';
import { ejecutarComparativaBacktest } from './trading/backtestEngine.js';
import { createGlobalRiskManager } from './trading/globalRiskManager.js';
import { createMarketCard } from './components/marketCard.js';
import {
  createRealPositionCard, createSimulatedPositionCard, resolverLimitesMonetarios,
} from './components/positionCards.js';
import { renderExecutionTable } from './components/executionTable.js';
import { renderAutoStatus } from './components/autoStatus.js';
import {
  renderBacktestResults, renderBacktestLoading, renderBacktestError,
} from './components/backtestResults.js';
import { renderMarketRanking } from './components/marketRanking.js';
import { createPositionChart } from './components/positionChart.js';
import { ordenarMercadosParaInicio } from './trading/marketRanking.js';
import { escanearMercadosEstables } from './trading/marketScanner.js';

let mercadosActivos = {};
let mercadosEscaneados = [];
let historial = [];
let historialId = 0;
let modoEjecucion = 'simulacion';
let saldoReal = 10000;
let saldoRealInicial = null;
let portfolioWs = null;
let contratosRealesAbiertos = [];
let positionChart = null;
let cooldownAutoSeg = 60;
let signalConfig = { ...SIGNAL_CONFIG_DEFAULTS };
let ultimoBacktest = null;
const estadosAutomaticos = {};
const riskManager = createRiskManager({ saldoInicial: saldoReal });
const marketCalibrationStore = createMarketCalibrationStore({
  storageKey: MARKET_CALIBRATION_STORAGE_KEY,
});
const globalRiskManager = createGlobalRiskManager({
  storageKey: GLOBAL_RISK_STORAGE_KEY,
});

function renderRegistroEjecuciones(registros) {
  renderExecutionTable({
    registros,
    tbody: document.getElementById('execution-body'),
    empty: document.getElementById('execution-empty'),
  });
  renderRankingMercados();
  renderEstadoRiesgoGlobal();
}

function renderRankingMercados() {
  const mercados = mercadosEscaneados.map(mercado => {
    const mercadoActivo = mercadosActivos[mercado.id];
    return {
      ...mercado,
      precio: mercadoActivo?.precio ?? mercado.precio,
      desviacion: mercadoActivo?.desviacion ?? mercado.desviacion,
      calidad: mercadoActivo?.calidad ?? mercado.calidad,
      calibracion: marketCalibrationStore.obtener(mercado.id),
      registros: executionJournal.registros,
    };
  });

  renderMarketRanking(
    document.getElementById('market-ranking'),
    ordenarMercadosParaInicio(mercados),
  );
}

async function actualizarRankingAutomatico() {
  const contenedor = document.getElementById('market-ranking');
  if (contenedor) {
    contenedor.innerHTML = '<div class="positions-empty">Analizando mercados estables...</div>';
  }

  try {
    const periodo = parseInt(document.getElementById('select-periodo').value) || 14;
    mercadosEscaneados = await escanearMercadosEstables({
      mercados: MERCADOS_ESTABLES,
      obtenerTicks: obtenerTicksHistoricos,
      periodo,
    });
    renderRankingMercados();

    if (!mercadosEscaneados.length && contenedor) {
      contenedor.innerHTML = '<div class="positions-empty">No fue posible analizar los mercados estables en este momento.</div>';
    }
  } catch (error) {
    console.error('No se pudo actualizar el top de mercados:', error);
    if (contenedor) {
      contenedor.innerHTML = '<div class="positions-empty">No fue posible actualizar el top de mercados.</div>';
    }
  }
}

async function abrirMercadoRecomendado(mercadoId) {
  if (mercadosActivos[mercadoId]) {
    document.getElementById(`card-${mercadoId}`)?.scrollIntoView({ behavior: 'smooth' });
    return;
  }

  const selector = document.getElementById('select-mercado');
  const opcion = Array.from(selector.options).find(item => item.value.startsWith(`${mercadoId}|`));
  if (!opcion) return;

  selector.value = opcion.value;
  await agregarMercado();
  document.getElementById(`card-${mercadoId}`)?.scrollIntoView({ behavior: 'smooth' });
}

const executionJournal = createExecutionJournal({
  storageKey: EXECUTION_STORAGE_KEY,
  onChange: renderRegistroEjecuciones,
});

function renderEstadoRiesgoGlobal() {
  const contenedor = document.getElementById('global-risk-status');
  if (!contenedor) return;
  const estado = globalRiskManager.estado(obtenerRegistrosParaRiesgo());
  const pausa = estado.pausado
    ? `Hasta ${new Date(estado.pausaHasta).toLocaleTimeString()}`
    : 'Disponible';
  contenedor.innerHTML = `
    <div class="summary-stat"><div class="summary-stat-label">Pérdida del día</div><div class="summary-stat-value">$${estado.perdidaDiaria.toFixed(2)}</div></div>
    <div class="summary-stat"><div class="summary-stat-label">Posiciones abiertas</div><div class="summary-stat-value">${estado.posicionesAbiertas}/${estado.config.maxPosicionesAbiertas}</div></div>
    <div class="summary-stat"><div class="summary-stat-label">Pérdidas seguidas</div><div class="summary-stat-value">${estado.perdidasConsecutivas}/${estado.config.maxPerdidasConsecutivas}</div></div>
    <div class="summary-stat"><div class="summary-stat-label">Operativa</div><div class="summary-stat-value" style="font-size:13px">${pausa}</div></div>
  `;
}

function abrirConfiguracionRiesgo() {
  document.getElementById('menu-dropdown').classList.remove('open');
  const estado = globalRiskManager.estado(obtenerRegistrosParaRiesgo());
  document.getElementById('global-max-daily-loss').value = estado.config.perdidaMaximaDiaria;
  document.getElementById('global-max-open').value = estado.config.maxPosicionesAbiertas;
  document.getElementById('global-max-losses').value = estado.config.maxPerdidasConsecutivas;
  document.getElementById('global-pause-minutes').value = estado.config.pausaMinutos;
  renderEstadoRiesgoGlobal();
  document.getElementById('risk-config-modal').style.display = 'flex';
}

function cerrarConfiguracionRiesgo() {
  document.getElementById('risk-config-modal').style.display = 'none';
}

function cerrarConfiguracionRiesgoClick(event) {
  if (event.target.id === 'risk-config-modal') cerrarConfiguracionRiesgo();
}

function guardarConfiguracionRiesgo() {
  globalRiskManager.configurar({
    perdidaMaximaDiaria: document.getElementById('global-max-daily-loss').value,
    maxPosicionesAbiertas: document.getElementById('global-max-open').value,
    maxPerdidasConsecutivas: document.getElementById('global-max-losses').value,
    pausaMinutos: document.getElementById('global-pause-minutes').value,
  });
  renderEstadoRiesgoGlobal();
  cerrarConfiguracionRiesgo();
  registrarLogAuto('Límites globales de riesgo actualizados.', 'success');
}

function reanudarOperativa() {
  globalRiskManager.reanudar();
  renderEstadoRiesgoGlobal();
  registrarLogAuto('Pausa global retirada manualmente.', 'info');
}

function obtenerRegistrosParaRiesgo() {
  const idsRegistrados = new Set(
    executionJournal.registros
      .filter(item => item.estado === 'pendiente')
      .map(item => String(item.id)),
  );
  const posicionesExternas = contratosRealesAbiertos
    .filter(id => !idsRegistrados.has(String(id)))
    .map(id => ({ id, estado: 'pendiente' }));
  return [...executionJournal.registros, ...posicionesExternas];
}

function validarAperturaPorRiesgo(riesgoOperacion) {
  return globalRiskManager.evaluar({
    registros: obtenerRegistrosParaRiesgo(),
    riesgoOperacion,
  });
}

function temaActual() {
  return document.body.dataset.theme === 'light' ? 'light' : 'dark';
}

function toggleTheme() {
  const actual = temaActual();
  const nuevo = actual === 'dark' ? 'light' : 'dark';
  document.body.dataset.theme = nuevo;
  document.getElementById('theme-toggle').textContent = nuevo === 'dark' ? '🌙 Oscuro' : '☀️ Claro';

  const t = TEMAS[nuevo];
  Object.values(mercadosActivos).forEach(m => {
    m.chart.applyOptions({
      layout: { background: { color: t.bg }, textColor: t.text },
      grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
      timeScale: { borderColor: t.border },
      rightPriceScale: { borderColor: t.border },
    });
  });
}

function cambiarModoInversion(modo) {
  riskManager.setModo(modo);
  document.getElementById('risk-input').disabled = modo !== 'porcentaje';
  document.getElementById('fixed-input').disabled = modo !== 'fijo';
}

function actualizarRiesgoPorcentaje(value) {
  riskManager.setPorcentaje(value);
}

function actualizarMontoFijo(value) {
  riskManager.setMontoFijo(value);
}

function actualizarCooldown(value) {
  cooldownAutoSeg = parseInt(value) || 60;
}

function cargarSignalConfig() {
  try {
    const guardada = JSON.parse(localStorage.getItem(SIGNAL_CONFIG_STORAGE_KEY) || '{}');
    signalConfig = normalizarSignalConfig({ ...SIGNAL_CONFIG_DEFAULTS, ...guardada });
  } catch (error) {
    signalConfig = { ...SIGNAL_CONFIG_DEFAULTS };
    console.error('No se pudo cargar la configuración de señales:', error);
  }
}

function obtenerSignalConfigMercado(mercadoId) {
  const calibracion = marketCalibrationStore.obtener(mercadoId);
  if (!calibracion) return signalConfig;
  return normalizarSignalConfig({
    ...signalConfig,
    umbralMinimo: calibracion.umbralMinimo,
    confirmacionesRequeridas: calibracion.confirmacionesRequeridas,
  });
}

function actualizarPanelAutomatico(mercadoId, cambios = {}) {
  const config = obtenerSignalConfigMercado(mercadoId);
  estadosAutomaticos[mercadoId] = {
    activo: autoTrader?.estaActivo(mercadoId) || false,
    tipo: 'WAIT',
    puntuacion: 0,
    confirmaciones: 0,
    cooldownRestante: autoTrader?.cooldownRestante(mercadoId) || 0,
    estadoForzado: null,
    ...estadosAutomaticos[mercadoId],
    ...cambios,
    config,
    calibrado: Boolean(marketCalibrationStore.obtener(mercadoId)),
  };
  renderAutoStatus(
    document.getElementById(`auto-status-${mercadoId}`),
    estadosAutomaticos[mercadoId],
  );
}

function renderCalibracionesMercado() {
  const contenedor = document.getElementById('market-calibration-list');
  if (!contenedor) return;
  const calibraciones = Object.values(marketCalibrationStore.listar());
  if (!calibraciones.length) {
    contenedor.className = 'positions-empty';
    contenedor.textContent = 'No hay calibraciones guardadas.';
    return;
  }
  contenedor.className = 'calibration-list';
  contenedor.innerHTML = calibraciones.map(item => `
    <div class="calibration-item">
      <span><b>${NOMBRES_SIMBOLOS[item.mercadoId] || item.mercadoId}</b> · ≥ ${item.umbralMinimo} · ${item.confirmacionesRequeridas} confirmaciones</span>
      <button class="btn-clear" onclick="eliminarCalibracionMercado('${item.mercadoId}')">Quitar</button>
    </div>
  `).join('');
}

function abrirConfiguracionSenales() {
  document.getElementById('menu-dropdown').classList.remove('open');
  document.getElementById('signal-threshold').value = signalConfig.umbralMinimo;
  document.getElementById('signal-confirmations').value = signalConfig.confirmacionesRequeridas;
  document.getElementById('signal-filter-auto').checked = signalConfig.filtrarAutoTrading;
  renderCalibracionesMercado();
  document.getElementById('signal-config-modal').style.display = 'flex';
}

function cerrarConfiguracionSenales() {
  document.getElementById('signal-config-modal').style.display = 'none';
}

function cerrarConfiguracionSenalesClick(event) {
  if (event.target.id === 'signal-config-modal') cerrarConfiguracionSenales();
}

function guardarConfiguracionSenales() {
  signalConfig = normalizarSignalConfig({
    umbralMinimo: document.getElementById('signal-threshold').value,
    confirmacionesRequeridas: document.getElementById('signal-confirmations').value,
    filtrarAutoTrading: document.getElementById('signal-filter-auto').checked,
  });
  localStorage.setItem(SIGNAL_CONFIG_STORAGE_KEY, JSON.stringify(signalConfig));
  cerrarConfiguracionSenales();
  registrarLogAuto(
    `Calidad de señales: mínimo ${signalConfig.umbralMinimo}/100 y ${signalConfig.confirmacionesRequeridas} confirmaciones.`,
    'success',
  );
}

function eliminarCalibracionMercado(mercadoId) {
  marketCalibrationStore.eliminar(mercadoId);
  renderCalibracionesMercado();
  renderRankingMercados();
  registrarLogAuto(`${NOMBRES_SIMBOLOS[mercadoId] || mercadoId}: calibración eliminada.`, 'info');
}

function toggleMenu() {
  document.getElementById('menu-dropdown').classList.toggle('open');
}

function abrirBacktesting() {
  document.getElementById('menu-dropdown').classList.remove('open');
  document.getElementById('backtest-modal').style.display = 'flex';
}

function cerrarBacktesting() {
  document.getElementById('backtest-modal').style.display = 'none';
}

function cerrarBacktestingClick(event) {
  if (event.target.id === 'backtest-modal') cerrarBacktesting();
}

function limpiarRegistroEjecuciones() {
  if (!confirm('¿Borrar todo el registro de ejecuciones?')) return;
  executionJournal.limpiar();
  registrarLogAuto('Registro de ejecuciones eliminado.', 'info');
}

function alternarRegistroEjecuciones() {
  const modal = document.getElementById('execution-modal');
  const boton = document.getElementById('execution-toggle');
  if (!modal || !boton) return;

  modal.style.display = 'flex';
  boton.setAttribute('aria-expanded', 'true');
}

function cerrarEjecuciones() {
  document.getElementById('execution-modal').style.display = 'none';
  document.getElementById('execution-toggle')?.setAttribute('aria-expanded', 'false');
}

function cerrarEjecucionesClick(event) {
  if (event.target.id === 'execution-modal') cerrarEjecuciones();
}

function abrirPosiciones() {
  document.getElementById('positions-modal').style.display = 'flex';
  renderPosicionesSimuladas(simulationEngine.posiciones);
  cargarPortfolio();
}

function cerrarPosiciones() {
  cerrarGraficoPosicion();
  document.getElementById('positions-modal').style.display = 'none';
}

function cerrarPosicionesClick(event) {
  if (event.target.id === 'positions-modal') cerrarPosiciones();
}

async function verGraficoPosicion(mercadoId, nombre) {
  const panel = document.getElementById('position-chart-panel');
  const contenedor = document.getElementById('position-chart');
  const loading = document.getElementById('position-chart-loading');
  panel.style.display = 'block';
  contenedor.style.display = 'none';
  loading.style.display = 'block';
  loading.textContent = `Cargando comportamiento reciente de ${nombre}...`;
  document.getElementById('position-chart-title').textContent = `${nombre} · comportamiento reciente`;

  if (positionChart) {
    positionChart.remove();
    positionChart = null;
  }

  try {
    const ticks = await obtenerTicksHistoricos(mercadoId, 120);
    if (!ticks.length) throw new Error('No hay precios históricos disponibles');
    loading.style.display = 'none';
    contenedor.style.display = 'block';
    positionChart = createPositionChart({
      contenedor,
      ticks,
      chartTheme: TEMAS[temaActual()],
    });
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    contenedor.style.display = 'none';
    loading.style.display = 'block';
    loading.textContent = `No se pudo cargar el gráfico: ${error.message}`;
  }
}

function cerrarGraficoPosicion() {
  if (positionChart) {
    positionChart.remove();
    positionChart = null;
  }
  const panel = document.getElementById('position-chart-panel');
  const contenedor = document.getElementById('position-chart');
  if (panel) panel.style.display = 'none';
  if (contenedor) {
    contenedor.style.display = 'none';
    contenedor.innerHTML = '';
  }
}

async function ejecutarBacktestActual() {
  const boton = document.getElementById('btn-backtest');
  const contenedor = document.getElementById('backtest-results');
  const [simbolo, nombre] = document.getElementById('select-mercado').value.split('|');
  const periodo = parseInt(document.getElementById('select-periodo').value);
  const count = parseInt(document.getElementById('backtest-count').value);
  const stake = calcularInversionSugerida();

  boton.disabled = true;
  boton.textContent = 'Analizando...';
  renderBacktestLoading(contenedor, `Cargando ${count.toLocaleString()} ticks de ${nombre}...`);

  try {
    const ticks = await obtenerTicksHistoricos(simbolo, count);
    const resultado = ejecutarComparativaBacktest({
      ticks,
      periodo,
      stake,
      saldoInicial: saldoReal,
      umbralSeleccionado: signalConfig.umbralMinimo,
      confirmacionesRequeridas: signalConfig.confirmacionesRequeridas,
    });
    ultimoBacktest = {
      mercadoId: simbolo,
      mercadoNombre: nombre,
      resultado: { ...resultado, mercadoId: simbolo, mercadoNombre: nombre },
    };
    renderBacktestResults(contenedor, ultimoBacktest.resultado);
  } catch (error) {
    console.error(error);
    renderBacktestError(contenedor, error.message);
  } finally {
    boton.disabled = false;
    boton.textContent = 'Ejecutar backtest';
  }
}

function aplicarCalibracionBacktest() {
  if (!ultimoBacktest?.resultado.recomendacion.disponible) return;
  const recomendacion = ultimoBacktest.resultado.recomendacion;
  marketCalibrationStore.establecer(ultimoBacktest.mercadoId, {
    umbralMinimo: recomendacion.umbralMinimo,
    confirmacionesRequeridas: recomendacion.confirmacionesRequeridas,
    total: recomendacion.total,
    winRate: recomendacion.winRate,
    pnl: recomendacion.pnl,
    maxDrawdown: recomendacion.maxDrawdown,
    muestraTicks: ultimoBacktest.resultado.totalTicks,
  });
  renderRankingMercados();
  registrarLogAuto(
    `${ultimoBacktest.mercadoNombre}: calibración aplicada en ≥ ${recomendacion.umbralMinimo} con ${recomendacion.confirmacionesRequeridas} confirmaciones.`,
    'success',
  );
}

function cambiarModoEjecucion(modo) {
  modoEjecucion = modo === 'demo' ? 'demo' : 'simulacion';
  registrarLogAuto(
    modoEjecucion === 'demo'
      ? 'Modo cuenta demo real activado. Las próximas ejecuciones enviarán órdenes a Deriv.'
      : 'Modo simulación segura activado. No se enviarán órdenes a Deriv.',
    modoEjecucion === 'demo' ? 'error' : 'success'
  );
}

function abrirHistorial() {
  document.getElementById('modal-overlay').style.display = 'flex';
}

function cerrarHistorial() {
  document.getElementById('modal-overlay').style.display = 'none';
}

function cerrarHistorialClick(event) {
  if (event.target.id === 'modal-overlay') cerrarHistorial();
}

function guardarHistorial() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ historial, historialId }));
  } catch (e) {
    console.error('No se pudo guardar el historial:', e);
  }
}

function cargarHistorialGuardado() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.historial)) historial = data.historial;
    if (typeof data.historialId === 'number') historialId = data.historialId;
  } catch (e) {
    console.error('No se pudo cargar el historial guardado:', e);
  }
}

function limpiarHistorial() {
  if (!confirm('¿Borrar todo el historial de señales guardado? Esta acción no se puede deshacer.')) return;
  historial = [];
  historialId = 0;
  localStorage.removeItem(STORAGE_KEY);
  renderHistorial();
}

function registrarLogAuto(mensaje, tipo) {
  const aviso = document.getElementById('execution-notice');
  aviso.textContent = mensaje;
  aviso.style.color = tipo === 'error' ? '#ef5350' : tipo === 'success' ? '#26a69a' : 'var(--text-secondary)';
}

function actualizarStatsBalance() {
  const saldoEl = document.getElementById('hist-saldo-sim');
  saldoEl.textContent = '$' + saldoReal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
  saldoEl.style.color = saldoRealInicial === null ? 'var(--text-primary)' : (saldoReal >= saldoRealInicial ? '#26a69a' : '#ef5350');

  const pnlTotal = saldoRealInicial === null ? 0 : saldoReal - saldoRealInicial;
  const pnlEl = document.getElementById('hist-pnl');
  pnlEl.textContent = (pnlTotal >= 0 ? '+$' : '-$') + Math.abs(pnlTotal).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
  pnlEl.style.color = pnlTotal >= 0 ? '#26a69a' : '#ef5350';
}

async function actualizarSaldo() {
  try {
    const data = await obtenerCuenta();
    const el = document.getElementById('balance-value');
    if (data.accountId) {
      saldoReal = parseFloat(data.balance);
      riskManager.setSaldo(saldoReal);
      if (saldoRealInicial === null) saldoRealInicial = saldoReal;
      const balance = saldoReal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
      el.textContent = `$${balance} ${data.currency}`;
      actualizarStatsBalance();
    } else {
      el.textContent = 'No disponible';
    }
  } catch (e) {
    document.getElementById('balance-value').textContent = 'Error';
  }
}

function parseShortcode(shortcode = '') {
  const tipo = shortcode.startsWith('MULTDOWN') ? 'MULTDOWN' : 'MULTUP';
  const shortcodeNormalizado = shortcode.toUpperCase();
  const simboloConocido = Object.keys(NOMBRES_SIMBOLOS)
    .sort((a, b) => b.length - a.length)
    .find(id => shortcodeNormalizado.includes(id.toUpperCase()));
  const shortcodeMatch = shortcode.match(/^MULT(?:UP|DOWN)_(.+?)_(\d+)_/);
  const simbolo = simboloConocido || shortcodeMatch?.[1] || 'Mercado';
  const multiplierMatch = shortcode.match(/MULT(?:UP|DOWN)_(?:.+?)_(\d+)_/);
  return { tipo, simbolo, multiplier: multiplierMatch?.[1] || '?' };
}

function crearTarjetaPosicion(contrato) {
  const contractId = contrato.contract_id;
  const { tipo, simbolo, multiplier } = parseShortcode(contrato.shortcode);
  const registro = executionJournal.obtener(contractId);
  const mercadoId = registro?.mercadoId
    || contrato.underlying
    || contrato.symbol
    || simbolo;
  const nombre = registro?.nombre || NOMBRES_SIMBOLOS[mercadoId] || mercadoId;
  const tipoLabel = tipo === 'MULTUP' ? '🟢 BUY' : '🔴 SELL';

  let div = document.getElementById(`pos-${contractId}`);
  if (div) return;

  const objetivos = calcularObjetivosMonetarios(
    registro?.stake ?? contrato.buy_price ?? 0,
  );
  const limites = resolverLimitesMonetarios({ contrato, registro, objetivos });
  div = createRealPositionCard({
    contrato, mercadoId, nombre, tipoLabel, multiplier, limites,
  });
  document.getElementById('real-positions').appendChild(div);
}

function actualizarTarjetaPosicion(c) {
  const el = document.getElementById(`pos-${c.contract_id}`);
  if (c.is_sold) {
    contratosRealesAbiertos = contratosRealesAbiertos.filter(
      id => String(id) !== String(c.contract_id),
    );
    const costos = extraerCostosReportados(c);
    executionJournal.cerrar(c.contract_id, {
      pnlNeto: c.profit,
      costos,
      pnlBruto: costos === null ? null : Number(c.profit) + costos,
    });
  }
  if (!el) return;

  const mercadoId = c.underlying || c.symbol;
  if (mercadoId && NOMBRES_SIMBOLOS[mercadoId]) {
    const nombre = NOMBRES_SIMBOLOS[mercadoId];
    el.querySelector('.position-market-name').textContent = nombre;
    const botonGrafico = el.querySelector('.position-chart-button');
    botonGrafico.onclick = () => verGraficoPosicion(mercadoId, nombre);
  }

  el.querySelector('.pos-spot').textContent = c.current_spot;
  const registro = executionJournal.obtener(c.contract_id);
  const limites = resolverLimitesMonetarios({
    contrato: c,
    registro,
    objetivos: calcularObjetivosMonetarios(registro?.stake ?? c.buy_price ?? 0),
  });
  el.querySelector('.pos-sl-amount').textContent = Number.isFinite(limites.stopLossAmount)
    ? `$${limites.stopLossAmount.toFixed(2)}` : '—';
  el.querySelector('.pos-tp-amount').textContent = Number.isFinite(limites.takeProfitAmount)
    ? `$${limites.takeProfitAmount.toFixed(2)}` : '—';
  const pnlEl = el.querySelector('.pos-pnl');
  pnlEl.textContent = (c.profit >= 0 ? '+$' : '-$') + Math.abs(c.profit).toFixed(2);
  pnlEl.style.color = c.profit >= 0 ? '#26a69a' : '#ef5350';

  const statusEl = el.querySelector('.pos-status');
  if (c.is_sold) {
    el.remove();
    const contenedor = document.getElementById('real-positions');
    if (!contenedor.querySelector('.position-card')) {
      contenedor.innerHTML = '<div class="positions-empty">No hay posiciones reales abiertas.</div>';
    }
    actualizarSaldo();
  } else {
    statusEl.textContent = 'Abierto';
  }
}

async function cargarPortfolio() {
  const contenedor = document.getElementById('real-positions');
  contenedor.innerHTML = '<div class="positions-empty">Cargando posiciones reales...</div>';

  try {
    const wsUrl = await obtenerWsUrl();
    if (portfolioWs) portfolioWs.close();
    portfolioWs = crearWebSocket(wsUrl, {
      onOpen: ws => solicitarPortfolio(ws),
      onMessage: msg => {
      if (msg.error) {
        contenedor.innerHTML = `<div class="positions-empty">Error: ${msg.error.message}</div>`;
        return;
      }

      if (msg.portfolio) {
        const contratos = msg.portfolio.contracts || [];
        contratosRealesAbiertos = contratos.map(c => c.contract_id);
        renderEstadoRiesgoGlobal();
        if (contratos.length === 0) {
          contenedor.innerHTML = '<div class="positions-empty">No hay posiciones reales abiertas.</div>';
          return;
        }
        contenedor.innerHTML = '';
        contratos.forEach(c => {
          crearTarjetaPosicion(c);
          suscribirContrato(portfolioWs, c.contract_id);
        });
      }

      if (msg.proposal_open_contract) {
        actualizarTarjetaPosicion(msg.proposal_open_contract);
      }

      if (msg.sell) {
        cargarPortfolio();
        actualizarSaldo();
      }
      },
      onError: () => {
        contenedor.innerHTML = '<div class="positions-empty">Error de conexión con Deriv.</div>';
      },
    });
  } catch (error) {
    contenedor.innerHTML = `<div class="positions-empty">Error: ${error.message}</div>`;
  }
}

const simulationEngine = createSimulationEngine({
  storageKey: SIM_STORAGE_KEY,
  getStake: () => calcularInversionSugerida(),
  getMultiplier: () => MULTIPLICADOR_DEFAULT,
  getNombre: id => NOMBRES_SIMBOLOS[id] || id,
  onChange: renderPosicionesSimuladas,
  onLog: registrarLogAuto,
  onOpen: posicion => executionJournal.abrir({
    id: posicion.id,
    mercadoId: posicion.mercadoId,
    nombre: posicion.nombre,
    tipo: posicion.tipo,
    modo: 'simulacion',
    origen: posicion.origen,
    stake: posicion.stake,
    entrada: posicion.entrada,
    multiplicador: posicion.multiplicador,
    costosReportados: 0,
    stopLossAmount: calcularObjetivosMonetarios(posicion.stake).riesgo,
    takeProfitAmount: calcularObjetivosMonetarios(posicion.stake).objetivo,
  }),
  onClose: (posicion, pnl) => executionJournal.cerrar(posicion.id, {
    pnlBruto: pnl,
    costos: 0,
    pnlNeto: pnl,
  }),
});

function renderPosicionesSimuladas(posiciones) {
  const grupo = document.getElementById('simulated-positions-group');
  const contenedor = document.getElementById('simulated-positions');
  if (!grupo || !contenedor) return;

  if (!posiciones.length) {
    grupo.style.display = 'none';
    contenedor.innerHTML = '';
    return;
  }

  grupo.style.display = 'flex';
  contenedor.innerHTML = '';
  posiciones.forEach(posicion => {
    contenedor.appendChild(createSimulatedPositionCard(
      posicion,
      calcularObjetivosMonetarios(posicion.stake),
    ));
  });
}

function abrirPosicionSimulada(...args) {
  return simulationEngine.abrir(...args);
}

function actualizarPosicionesSimuladas(...args) {
  simulationEngine.actualizar(...args);
}

function cerrarPosicionSimulada(id) {
  simulationEngine.cerrar(id);
}

function cerrarPosicion(contractId) {
  if (!portfolioWs || portfolioWs.readyState !== WebSocket.OPEN) {
    alert('Reconectando, intenta de nuevo en un momento.');
    return;
  }
  cerrarContrato(portfolioWs, contractId);
}

async function ejecutarOperacion(mercadoId, tipo, entrada, sl, tp, btnId) {
  const stake = calcularInversionSugerida();
  const objetivos = calcularObjetivosMonetarios(stake);
  const nombre = NOMBRES_SIMBOLOS[mercadoId] || mercadoId;
  const evaluacionRiesgo = validarAperturaPorRiesgo(objetivos.riesgo);
  if (!evaluacionRiesgo.permitido) {
    alert(`Operación bloqueada por riesgo:\n\n${evaluacionRiesgo.motivo}`);
    renderEstadoRiesgoGlobal();
    return false;
  }
  if (modoEjecucion === 'simulacion') {
    abrirPosicionSimulada(mercadoId, tipo, entrada, sl, tp);
    return true;
  }

  const btn = document.getElementById(btnId);
  if (btn) { btn.disabled = true; btn.textContent = 'Cotizando...'; }

  try {
    const resultado = await ejecutarOrdenDemo({
      mercadoId, tipo, stake, entrada, sl, tp,
    }, {
      confirmarCotizacion: cotizacion => confirm(
        `Confirmar operación REAL en tu cuenta demo:\n\n`
        + `Mercado: ${nombre}\n`
        + `Tipo: ${tipo}\n`
        + `Inversión: $${stake.toFixed(2)}\n`
        + `Precio cotizado: $${cotizacion.precioCotizado?.toFixed(2) ?? '—'}\n`
        + `Multiplicador aceptado: x${cotizacion.multiplicador ?? '—'}\n`
        + `Costos reportados: ${cotizacion.costosReportados === null ? 'No separados por Deriv' : `$${cotizacion.costosReportados.toFixed(2)}`}\n`
        + `Riesgo máximo: $${objetivos.riesgo.toFixed(2)}\n`
        + `Objetivo de ganancia: $${objetivos.objetivo.toFixed(2)}\n`
        + `Entrada: ${entrada.toFixed(2)}\n`
        + `Stop Loss: ${sl.toFixed(2)}\n`
        + `Take Profit: ${tp.toFixed(2)}\n\n`
        + `¿Ejecutar esta operación ahora?`
      ),
    });
      if (resultado.cancelada) return;
      const { compra, multiplicador, cotizacion } = resultado;
      executionJournal.abrir({
        id: compra.contract_id,
        mercadoId,
        nombre,
        tipo,
        modo: 'demo',
        origen: 'manual',
        stake,
        entrada,
        multiplicador: cotizacion.multiplicador ?? multiplicador,
        precioCotizado: cotizacion.precioCotizado,
        costosReportados: cotizacion.costosReportados,
        stopLossAmount: objetivos.riesgo,
        takeProfitAmount: objetivos.objetivo,
      });
      alert(`✅ Operación ejecutada\n\nContrato: ${compra.contract_id}\nPrecio compra: $${compra.buy_price}\nMultiplicador: x${multiplicador}\nSaldo restante: $${compra.balance_after}`);
      actualizarSaldo();
      cargarPortfolio();
      return true;
  } catch (error) {
    alert(`❌ Error: ${error.message}`);
    return false;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Ejecutar en demo'; }
  }
}

async function ejecutarOperacionAutomaticaCore(mercadoId, tipo, entrada, sl, tp) {
  const stake = calcularInversionSugerida();
  const objetivos = calcularObjetivosMonetarios(stake);
  const nombre = NOMBRES_SIMBOLOS[mercadoId] || mercadoId;
  const evaluacionRiesgo = validarAperturaPorRiesgo(objetivos.riesgo);
  if (!evaluacionRiesgo.permitido) {
    renderEstadoRiesgoGlobal();
    throw new Error(`Bloqueada por riesgo: ${evaluacionRiesgo.motivo}`);
  }
  if (modoEjecucion === 'simulacion') {
    abrirPosicionSimulada(mercadoId, tipo, entrada, sl, tp, 'automatica');
    return true;
  }

  registrarLogAuto(`${nombre} ${tipo}: solicitando cotización ($${stake.toFixed(2)})...`, 'info');

  try {
    const { compra, multiplicador, cotizacion } = await ejecutarOrdenDemo({
      mercadoId, tipo, stake, entrada, sl, tp,
    });
      executionJournal.abrir({
        id: compra.contract_id,
        mercadoId,
        nombre,
        tipo,
        modo: 'demo',
        origen: 'automatica',
        stake,
        entrada,
        multiplicador: cotizacion.multiplicador ?? multiplicador,
        precioCotizado: cotizacion.precioCotizado,
        costosReportados: cotizacion.costosReportados,
        stopLossAmount: objetivos.riesgo,
        takeProfitAmount: objetivos.objetivo,
      });
      registrarLogAuto(`✅ ${nombre} ${tipo} ejecutado — contrato ${compra.contract_id} | $${stake.toFixed(2)} | x${multiplicador} | saldo: $${compra.balance_after}`, 'success');
      actualizarSaldo();
      cargarPortfolio();
      return true;
  } catch (error) {
    registrarLogAuto(`❌ ${nombre} ${tipo}: ${error.message}`, 'error');
    throw error;
  }
}

const autoTrader = createAutoTrader({
  getCooldown: () => cooldownAutoSeg,
  getNombre: id => mercadosActivos[id]?.nombre || NOMBRES_SIMBOLOS[id] || id,
  onLog: registrarLogAuto,
  execute: ejecutarOperacionAutomaticaCore,
});

function toggleAutoMercado(id, activo) {
  autoTrader.toggle(id, activo);
  actualizarPanelAutomatico(id, {
    activo,
    estadoForzado: null,
  });
}

function ejecutarOperacionAuto(...args) {
  return autoTrader.procesar(...args);
}

function calcularInversionSugerida() {
  return riskManager.calcularInversion();
}

function etiquetaInversion() {
  return riskManager.etiqueta();
}

function registrarSenal(mercadoId, nombre, tipo, hora, entrada, sl, tp) {
  historialId++;
  const stake = calcularInversionSugerida();
  historial.unshift({
    id: historialId,
    mercadoId,
    nombre,
    tipo,
    hora,
    entrada,
    sl,
    tp,
    stake,
    estado: 'pendiente',
    horaResultado: null,
    pnl: null
  });
  renderHistorial();
}

function revisarPendientes(mercadoId, precio, hora) {
  let cambios = false;
  historial.forEach(h => {
    if (h.mercadoId !== mercadoId || h.estado !== 'pendiente') return;
    const salida = evaluarSalidaPorPrecio({ ...h, precio });
    if (!salida) return;

    const objetivos = calcularObjetivosMonetarios(h.stake);
    h.estado = salida === 'take_profit' ? 'ganada' : 'perdida';
    h.horaResultado = hora;
    h.pnl = salida === 'take_profit' ? objetivos.objetivo : -objetivos.riesgo;
    cambios = true;
  });
  if (cambios) renderHistorial();
}

function renderHistorial() {
  const tabla = document.getElementById('history-table');
  const tbody = document.getElementById('history-body');
  const vacio = document.getElementById('history-empty');

  if (historial.length === 0) {
    tabla.style.display = 'none';
    vacio.style.display = 'block';
  } else {
    tabla.style.display = 'table';
    vacio.style.display = 'none';

    tbody.innerHTML = historial.slice(0, MAX_HISTORIAL_VISIBLE).map(h => {
      const tagTipo = h.tipo === 'BUY' ? 'tag-buy' : 'tag-sell';
      const tagEstado = `tag-${h.estado}`;
      const estadoTexto = h.estado === 'pendiente' ? '⏳ Pendiente'
        : h.estado === 'ganada' ? `✅ Ganada (${h.horaResultado})`
        : `❌ Perdida (${h.horaResultado})`;
      const pnlTexto = h.pnl === null ? '—'
        : (h.pnl >= 0 ? '+$' + h.pnl.toFixed(2) : '-$' + Math.abs(h.pnl).toFixed(2));
      const pnlColor = h.pnl === null ? 'var(--text-faint)' : (h.pnl >= 0 ? '#26a69a' : '#ef5350');
      return `
        <tr>
          <td>${h.hora}</td>
          <td>${h.nombre}</td>
          <td><span class="tag ${tagTipo}">${h.tipo}</span></td>
          <td>${h.entrada.toFixed(2)}</td>
          <td>${h.sl.toFixed(2)}</td>
          <td>${h.tp.toFixed(2)}</td>
          <td>$${h.stake.toFixed(2)}</td>
          <td><span class="tag ${tagEstado}">${estadoTexto}</span></td>
          <td style="color:${pnlColor}; font-weight:600">${pnlTexto}</td>
        </tr>
      `;
    }).join('');
  }

  const total = historial.length;
  const ganadas = historial.filter(h => h.estado === 'ganada').length;
  const perdidas = historial.filter(h => h.estado === 'perdida').length;
  const resueltas = ganadas + perdidas;
  const winrate = resueltas > 0 ? ((ganadas / resueltas) * 100).toFixed(1) + '%' : '—';

  document.getElementById('hist-total').textContent = total;
  document.getElementById('hist-ganadas').textContent = ganadas;
  document.getElementById('hist-perdidas').textContent = perdidas;
  document.getElementById('hist-winrate').textContent = winrate;

  guardarHistorial();
}

function crearTarjeta(id, nombre, perfil, periodo) {
  document.getElementById('empty').style.display = 'none';
  return createMarketCard({ id, nombre, perfil, periodo, chartTheme: TEMAS[temaActual()] });
}

function renderPlan(entrada, sl, tp, tipo, mercadoId, calidad) {
  const inversion = calcularInversionSugerida();
  const { riesgo: riesgoMonetario, objetivo: objetivoMonetario } = calcularObjetivosMonetarios(inversion);
  const btnId = `exec-${mercadoId}`;
  const btnClass = tipo === 'SELL' ? 'btn-execute sell' : 'btn-execute';
  const accionTexto = modoEjecucion === 'simulacion' ? 'Abrir simulación' : 'Ejecutar en demo';
  const autoBadge = autoTrader.estaActivo(mercadoId) ? '<span style="font-size:10px;padding:2px 6px;border-radius:4px;font-weight:500;background:rgba(41,98,255,0.15);color:#2962ff;margin-left:6px">🤖 AUTO</span>' : '';
  return `
    <div class="trade-plan">
      <div>
        <div class="trade-plan-label">Entrada</div>
        <div class="trade-plan-value">${entrada.toFixed(2)}</div>
      </div>
      <div>
        <div class="trade-plan-label">Stop loss</div>
        <div class="trade-plan-value sl">${sl.toFixed(2)}</div>
      </div>
      <div>
        <div class="trade-plan-label">Take profit</div>
        <div class="trade-plan-value tp">${tp.toFixed(2)}</div>
      </div>
    </div>
    <div class="trade-plan-extra">
      <span class="trade-plan-extra-label">Inversión (${etiquetaInversion()})${autoBadge}</span>
      <span class="trade-plan-extra-value">$${inversion.toFixed(2)}</span>
    </div>
    <div class="trade-plan-ratio">Riesgo máximo: $${riesgoMonetario.toFixed(2)} · Objetivo: $${objetivoMonetario.toFixed(2)} · Relación 1 : ${RATIO_RECOMPENSA}</div>
    <div class="signal-quality signal-quality-${calidad.nivel}">
      Calidad estimada: <b>${calidad.puntuacion}/100</b> · ${calidad.nivel}
    </div>
    <button id="${btnId}" class="${btnClass}" onclick="ejecutarOperacion('${mercadoId}', '${tipo}', ${entrada}, ${sl}, ${tp}, '${btnId}')">${accionTexto}</button>
  `;
}

function actualizarTarjeta(id, precio, ma, rsi, hora, periodo, desv, precios) {
  const el = document.getElementById(`card-${id}`);
  if (!el) return 'WAIT';
  el.querySelector('.precio').textContent = precio.toLocaleString();
  el.querySelector('.ma').textContent = parseFloat(ma).toLocaleString(undefined, {maximumFractionDigits: 4});
  el.querySelector('.rsi').textContent = rsi;
  el.querySelector('.card-time').textContent = hora;
  el.querySelector('.ticks').textContent = `${periodo}/${periodo}`;

  const maNum = parseFloat(ma);
  const rsiNum = parseFloat(rsi);
  let html = '';
  let tipoSenal = 'WAIT';

  const senal = evaluarSenal({ precio, ma: maNum, rsi: rsiNum, desviacion: desv });
  const calidad = puntuarSenal({
    tipo: senal.tipo,
    precio,
    ma: maNum,
    rsi: rsiNum,
    desviacion: desv,
    precios,
  });
  if (senal.tipo === 'BUY') {
    tipoSenal = senal.tipo;
    const { sl, tp } = senal;
    html = '<div class="signal signal-buy">▲ BUY</div>' + renderPlan(precio, sl, tp, 'BUY', id, calidad);
  } else if (senal.tipo === 'SELL') {
    tipoSenal = senal.tipo;
    const { sl, tp } = senal;
    html = '<div class="signal signal-sell">▼ SELL</div>' + renderPlan(precio, sl, tp, 'SELL', id, calidad);
  } else {
    html = '<div class="signal signal-wait">— Esperar</div>';
  }
  el.querySelector('.signal-container').innerHTML = html;

  return { tipo: tipoSenal, calidad };
}

async function agregarMercado() {
  const btn = document.getElementById('btn-add-market');
  const sel = document.getElementById('select-mercado');
  const periodo = parseInt(document.getElementById('select-periodo').value);
  const [simbolo, nombre, perfil] = sel.value.split('|');
  const id = simbolo;

  if (mercadosActivos[id]) {
    alert(`${nombre} ya está activo.`);
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Conectando...';

  try {
    if (typeof LightweightCharts === 'undefined') {
      throw new Error('No se pudo cargar la librería del gráfico');
    }

    const { chart, candleSeries, maSeries } = crearTarjeta(id, nombre, perfil, periodo);
    actualizarPanelAutomatico(id);
    const wsUrl = await obtenerWsUrl();
    const precios = [];
    let velaActual = null;
    let tiempoVelaActual = null;
    let ultimaSenal = 'WAIT';
    const signalTrigger = createSignalTrigger();
    const ws = crearWebSocket(wsUrl, {
      onOpen: socket => {
      suscribirTicks(socket, simbolo);
      const el = document.getElementById(`card-${id}`);
      if (el) el.querySelector('.signal-container').innerHTML =
        '<div class="signal signal-loading">Recopilando precios...</div>';
      btn.disabled = false;
      btn.textContent = '+ Agregar';
      },
      onMessage: msg => {
      if (msg.error) {
        const el = document.getElementById(`card-${id}`);
        if (el) el.querySelector('.signal-container').innerHTML =
          `<div class="signal signal-sell">Error: ${msg.error.message}</div>`;
        return;
      }
      if (msg.tick) {
        const precio = msg.tick.quote;
        const epoch = msg.tick.epoch;
        const hora = new Date(epoch * 1000).toLocaleTimeString();
        const tiempoVela = Math.floor(epoch / INTERVALO_VELA) * INTERVALO_VELA;

        precios.push(precio);

        const el = document.getElementById(`card-${id}`);
        if (el) el.querySelector('.ticks').textContent =
          `${Math.min(precios.length, periodo)}/${periodo}`;

        if (tiempoVelaActual === null || tiempoVela > tiempoVelaActual) {
          velaActual = { time: tiempoVela, open: precio, high: precio, low: precio, close: precio };
          tiempoVelaActual = tiempoVela;
        } else {
          velaActual.high = Math.max(velaActual.high, precio);
          velaActual.low = Math.min(velaActual.low, precio);
          velaActual.close = precio;
        }
        candleSeries.update(velaActual);

        revisarPendientes(id, precio, hora);
        actualizarPosicionesSimuladas(id, precio);

        if (precios.length < periodo) return;
        if (precios.length > periodo) precios.shift();

        const ma = calcularMA(precios);
        const rsi = calcularRSI(precios);
        const desv = calcularDesviacion(precios, ma);

        maSeries.update({ time: tiempoVela, value: ma });
        const resultadoSenal = actualizarTarjeta(
          id, precio, ma.toFixed(4), rsi, hora, periodo, desv, precios,
        );
        if (mercadosActivos[id]) {
          Object.assign(mercadosActivos[id], {
            precio,
            desviacion: desv,
            calidad: resultadoSenal.calidad.puntuacion,
          });
          renderRankingMercados();
        }
        const tipoSenal = resultadoSenal.tipo;
        const sl = tipoSenal === 'BUY' ? precio - desv * 2 : precio + desv * 2;
        const tp = tipoSenal === 'BUY' ? precio + desv * 3 : precio - desv * 3;

        if (tipoSenal !== 'WAIT' && tipoSenal !== ultimaSenal) {
          registrarSenal(id, nombre, tipoSenal, hora, precio, sl, tp);
        }

        const configMercado = obtenerSignalConfigMercado(id);
        const disparo = signalTrigger.evaluar({
          tipo: tipoSenal,
          puntuacion: resultadoSenal.calidad.puntuacion,
          activo: autoTrader.estaActivo(id),
          config: configMercado,
        });
        actualizarPanelAutomatico(id, {
          activo: autoTrader.estaActivo(id),
          tipo: tipoSenal,
          puntuacion: resultadoSenal.calidad.puntuacion,
          confirmaciones: disparo.confirmaciones,
          cooldownRestante: autoTrader.cooldownRestante(id),
          estadoForzado: null,
        });
        if (disparo.ejecutar) {
          actualizarPanelAutomatico(id, { estadoForzado: 'opening' });
          registrarLogAuto(
            `${nombre} ${tipoSenal}: calidad confirmada ${resultadoSenal.calidad.puntuacion}/100. Abriendo operación automática.`,
            'success',
          );
          ejecutarOperacionAuto(id, tipoSenal, precio, sl, tp)
            .then(ejecutada => {
              if (!ejecutada) {
                signalTrigger.liberar();
                actualizarPanelAutomatico(id, {
                  estadoForzado: null,
                  cooldownRestante: autoTrader.cooldownRestante(id),
                });
                return;
              }
              actualizarPanelAutomatico(id, {
                estadoForzado: 'executed',
                cooldownRestante: autoTrader.cooldownRestante(id),
              });
            })
            .catch(error => {
              signalTrigger.liberar();
              actualizarPanelAutomatico(id, { estadoForzado: 'error' });
              registrarLogAuto(
                `${nombre} ${tipoSenal}: no se pudo abrir automáticamente. ${error.message}`,
                'error',
              );
            });
        } else if (
          tipoSenal !== 'WAIT'
          && autoTrader.estaActivo(id)
          && disparo.confirmaciones === 1
        ) {
          registrarLogAuto(
            `${nombre} ${tipoSenal}: esperando calidad ${configMercado.umbralMinimo}/100. Actual ${resultadoSenal.calidad.puntuacion}/100.`,
            'info',
          );
        }
        ultimaSenal = tipoSenal;
      }
      },
      onError: () => {
      const el = document.getElementById(`card-${id}`);
      if (el) el.querySelector('.signal-container').innerHTML =
        '<div class="signal signal-sell">Error de conexión con Deriv</div>';
      btn.disabled = false;
      btn.textContent = '+ Agregar';
      },
    });

    mercadosActivos[id] = {
      ws,
      nombre,
      perfil,
      chart,
      precio: null,
      desviacion: null,
      calidad: 0,
    };
    renderRankingMercados();
  } catch (error) {
    console.error(error);
    const el = document.getElementById(`card-${id}`);
    if (el) {
      el.querySelector('.signal-container').innerHTML =
        `<div class="signal signal-sell">Error: ${error.message}</div>`;
    } else {
      alert(`No se pudo agregar ${nombre}: ${error.message}`);
    }
    btn.disabled = false;
    btn.textContent = '+ Agregar';
  }
}

function quitarMercado(id) {
  if (mercadosActivos[id]) {
    mercadosActivos[id].ws.close();
    mercadosActivos[id].chart.remove();
    delete mercadosActivos[id];
  }
  autoTrader.eliminar(id);
  delete estadosAutomaticos[id];
  const el = document.getElementById(`card-${id}`);
  if (el) el.remove();
  renderRankingMercados();
  if (Object.keys(mercadosActivos).length === 0) {
    document.getElementById('empty').style.display = 'block';
  }
}

marketCalibrationStore.cargar();
globalRiskManager.cargar();
cargarSignalConfig();
cargarHistorialGuardado();
executionJournal.cargar();
simulationEngine.cargar();
actualizarSaldo();
setInterval(actualizarSaldo, 30000);
renderHistorial();
cargarPortfolio();
actualizarRankingAutomatico();
setInterval(actualizarRankingAutomatico, 300000);

Object.assign(window, {
  toggleTheme,
  cambiarModoInversion,
  cambiarModoEjecucion,
  actualizarRiesgoPorcentaje,
  actualizarMontoFijo,
  actualizarCooldown,
  abrirConfiguracionSenales,
  cerrarConfiguracionSenales,
  cerrarConfiguracionSenalesClick,
  guardarConfiguracionSenales,
  abrirConfiguracionRiesgo,
  cerrarConfiguracionRiesgo,
  cerrarConfiguracionRiesgoClick,
  guardarConfiguracionRiesgo,
  reanudarOperativa,
  eliminarCalibracionMercado,
  toggleMenu,
  abrirBacktesting,
  cerrarBacktesting,
  cerrarBacktestingClick,
  limpiarRegistroEjecuciones,
  alternarRegistroEjecuciones,
  cerrarEjecuciones,
  cerrarEjecucionesClick,
  abrirPosiciones,
  cerrarPosiciones,
  cerrarPosicionesClick,
  verGraficoPosicion,
  cerrarGraficoPosicion,
  ejecutarBacktestActual,
  aplicarCalibracionBacktest,
  abrirHistorial,
  cerrarHistorial,
  cerrarHistorialClick,
  limpiarHistorial,
  toggleAutoMercado,
  cargarPortfolio,
  cerrarPosicion,
  cerrarPosicionSimulada,
  ejecutarOperacion,
  abrirMercadoRecomendado,
  agregarMercado,
  quitarMercado,
});
