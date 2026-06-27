import {
  INTERVALO_VELA, MAX_HISTORIAL_VISIBLE, RATIO_RECOMPENSA, MULTIPLICADOR_DEFAULT,
  STORAGE_KEY, SIM_STORAGE_KEY,
  EXECUTION_STORAGE_KEY, SIGNAL_CONFIG_STORAGE_KEY, STRATEGY_CONFIG_STORAGE_KEY,
  MARKET_CALIBRATION_STORAGE_KEY,
  GLOBAL_RISK_STORAGE_KEY, ORDER_AUDIT_STORAGE_KEY, NOMBRES_SIMBOLOS, MERCADOS_ESTABLES, TEMAS,
} from './config.js';
import { obtenerCuenta, obtenerWsUrl } from './services/derivApi.js';
import { obtenerTicksHistoricos } from './services/historicalDataService.js';
import { iniciarSincronizacionCloud } from './services/cloudStateService.js';
import {
  crearWebSocket, suscribirTicks, solicitarPortfolio, suscribirContrato,
  solicitarContratoEstado, cerrarContrato,
} from './services/websocketService.js';
import {
  createRiskManager, calcularObjetivosMonetarios, evaluarSalidaPorPrecio,
} from './trading/riskManager.js';
import { createSimulationEngine } from './trading/simulationEngine.js';
import { createAutoTrader } from './trading/autoTrader.js';
import { createExecutionJournal } from './trading/executionJournal.js';
import { createOrderAudit } from './trading/orderAudit.js';
import { ejecutarOrdenDemo, extraerCostosReportados } from './trading/orderService.js';
import { calcularMA, calcularRSI, calcularDesviacion, evaluarSenal } from './trading/strategy.js';
import {
  SIGNAL_CONFIG_DEFAULTS, createSignalTrigger, normalizarSignalConfig, puntuarSenal,
} from './trading/signalScorer.js';
import {
  STRATEGY_CONFIG_DEFAULTS, evaluarReglasEstrategia, normalizarStrategyConfig,
} from './trading/strategyRules.js';
import { createMarketCalibrationStore } from './trading/marketCalibration.js';
import { ejecutarComparativaBacktest } from './trading/backtestEngine.js';
import { createGlobalRiskManager } from './trading/globalRiskManager.js';
import { evaluarPreparacionReal, evaluarSemanaTrading } from './trading/weeklyEvaluation.js';
import { createMarketCard } from './components/marketCard.js';
import {
  createRealPositionCard, createSimulatedPositionCard, resolverLimitesMonetarios,
  obtenerTimestampContrato,
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
import { evaluarCandidatoCanasta, seleccionarMercadosCanasta } from './trading/basketTrader.js';

let mercadosActivos = {};
let mercadosEscaneados = [];
let actualizacionRankingEnCurso = false;
let historial = [];
let historialId = 0;
let modoEjecucion = 'simulacion';
const REAL_CONTROLADO_MAX_STAKE = 2;
const FEE_REVIEW_INTERVAL_SECONDS = 30 * 60;
const MARKET_RANKING_REFRESH_MS = 2 * 60 * 1000;
let saldoReal = 10000;
const saldosInicialesPorCuenta = { demo: null, real: null };
let portfolioWs = null;
const contratosDerivAbiertosPorCuenta = { demo: [], real: [] };
const contratosDerivMercadoPorCuenta = { demo: {}, real: {} };
const cargosReportadosPorContrato = {};
const marketHealth = {};
const productionHealth = {
  deriv: { estado: 'warn', texto: 'Inicializando...' },
  portfolio: { estado: 'warn', texto: 'Pendiente' },
  mercados: { estado: 'warn', texto: 'Sin datos' },
};
const alertasProduccion = [];
let positionChart = null;
let positionChartWs = null;
let positionChartTimer = null;
let cooldownAutoSeg = 60;
let signalConfig = { ...SIGNAL_CONFIG_DEFAULTS };
let strategyConfig = { ...STRATEGY_CONFIG_DEFAULTS };
let ultimoBacktest = null;
const estadosAutomaticos = {};
const notificacionesOportunidad = {};
let oportunidadFueraHorario = null;
let filtroEjecuciones = 'todos';
let filtroHistorial = 'todos';
const riskManager = createRiskManager({ saldoInicial: saldoReal });
const marketCalibrationStore = createMarketCalibrationStore({
  storageKey: MARKET_CALIBRATION_STORAGE_KEY,
});
const globalRiskManager = createGlobalRiskManager({
  storageKey: GLOBAL_RISK_STORAGE_KEY,
});

const cloudSyncReady = iniciarSincronizacionCloud([
  STORAGE_KEY,
  SIM_STORAGE_KEY,
  EXECUTION_STORAGE_KEY,
  SIGNAL_CONFIG_STORAGE_KEY,
  STRATEGY_CONFIG_STORAGE_KEY,
  MARKET_CALIBRATION_STORAGE_KEY,
  GLOBAL_RISK_STORAGE_KEY,
  ORDER_AUDIT_STORAGE_KEY,
]).catch(error => {
  console.warn('La sincronización cloud no pudo iniciar:', error);
});

function renderRegistroEjecuciones(registros) {
  renderResumenEjecuciones(registros);
  const registrosFiltrados = filtrarEjecuciones(registros);
  renderExecutionTable({
    registros: registrosFiltrados,
    tbody: document.getElementById('execution-body'),
    empty: document.getElementById('execution-empty'),
  });
  renderRankingMercados();
  renderEstadoRiesgoGlobal();
}

function filtrarEjecuciones(registros) {
  if (filtroEjecuciones === 'todos') return registros;
  if (['demo', 'real', 'simulacion'].includes(filtroEjecuciones)) {
    return registros.filter(item => item.modo === filtroEjecuciones);
  }
  return registros.filter(item => item.estado === filtroEjecuciones);
}

function cambiarFiltroEjecuciones(filtro) {
  filtroEjecuciones = filtro;
  document.querySelectorAll('[data-execution-filter]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.executionFilter === filtro);
  });
  renderRegistroEjecuciones(executionJournal.registros);
}

function filtrarHistorial(registros) {
  if (filtroHistorial === 'todos') return registros;
  if (['BUY', 'SELL'].includes(filtroHistorial)) {
    return registros.filter(item => item.tipo === filtroHistorial);
  }
  return registros.filter(item => item.estado === filtroHistorial);
}

function cambiarFiltroHistorial(filtro) {
  filtroHistorial = filtro;
  document.querySelectorAll('[data-history-filter]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.historyFilter === filtro);
  });
  renderHistorial();
}

function navegarA(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function mensajeAmigableError(error) {
  const mensaje = String(error?.message || error || 'Error desconocido');
  if (/account not found/i.test(mensaje)) {
    return 'Deriv no encontró esa cuenta. Revisa que el token y el Account ID pertenezcan a la misma cuenta.';
  }
  if (/invalid token|authorization|unauthorized/i.test(mensaje)) {
    return 'Deriv rechazó el token. Revisa que esté vigente y tenga permisos Read y Trade.';
  }
  if (/network|fetch|websocket|connection/i.test(mensaje)) {
    return 'No se pudo conectar con Deriv en este momento. Intenta actualizar de nuevo.';
  }
  return mensaje;
}

function renderResumenEjecuciones(registros = []) {
  const cuentaActual = modoEjecucion === 'real' ? 'real' : 'demo';
  const idsAbiertosDeriv = new Set((contratosDerivAbiertosPorCuenta[cuentaActual] || []).map(id => String(id)));
  const registrosCuenta = registros.filter(item => item.modo === cuentaActual);
  const registrosVigentes = registrosCuenta.filter(item => (
    item.estado !== 'pendiente' || idsAbiertosDeriv.has(String(item.id))
  ));
  const ganadas = registrosVigentes.filter(item => item.estado === 'ganada').length;
  const perdidas = registrosVigentes.filter(item => item.estado === 'perdida').length;
  const resueltas = ganadas + perdidas;
  const winrate = resueltas > 0 ? `${((ganadas / resueltas) * 100).toFixed(1)}%` : '—';
  const pnlCerrado = registrosVigentes.reduce((total, item) => {
    if (item.estado === 'pendiente') return total;
    const pnl = Number(item.pnlNeto ?? item.pnl);
    return Number.isFinite(pnl) ? total + pnl : total;
  }, 0);
  const perdidaAcumulada = registrosVigentes.reduce((totalPerdido, item) => {
    const pnl = Number(item.pnlNeto ?? item.pnl);
    return Number.isFinite(pnl) && pnl < 0 ? totalPerdido + Math.abs(pnl) : totalPerdido;
  }, 0);

  const pnlEl = document.getElementById('hist-pnl');
  const pnlLabel = document.getElementById('hist-pnl-label');
  const totalLabel = document.getElementById('hist-total-label');
  if (totalLabel) totalLabel.textContent = cuentaActual === 'real' ? 'Operaciones reales' : 'Operaciones demo';
  if (pnlLabel) pnlLabel.textContent = cuentaActual === 'real' ? 'P&L real cerrado' : 'P&L demo cerrado';
  pnlEl.textContent = (pnlCerrado >= 0 ? '+$' : '-$')
    + Math.abs(pnlCerrado).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  pnlEl.style.color = pnlCerrado >= 0 ? '#26a69a' : '#ef5350';

  document.getElementById('hist-total').textContent = registrosVigentes.length;
  document.getElementById('hist-ganadas').textContent = ganadas;
  document.getElementById('hist-perdidas').textContent = perdidas;
  document.getElementById('hist-winrate').textContent = winrate;
  document.getElementById('hist-loss-amount').textContent =
    `$${perdidaAcumulada.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderRankingMercados() {
  const mercados = obtenerMercadosRankeados();

  renderMarketRanking(
    document.getElementById('market-ranking'),
    mercados,
  );
}

function obtenerMercadosRankeados() {
  const estadoEstrategia = evaluarReglasEstrategia({
    config: strategyConfig,
    registros: executionJournal.registros,
  });
  const mercados = mercadosEscaneados.map(mercado => {
    const mercadoActivo = mercadosActivos[mercado.id];
    const calibracion = marketCalibrationStore.obtener(mercado.id);
    return {
      ...mercado,
      precio: mercadoActivo?.precio ?? mercado.precio,
      desviacion: mercadoActivo?.desviacion ?? mercado.desviacion,
      calidad: mercadoActivo?.calidad ?? mercado.calidad,
      calibracion,
      signalConfig: obtenerSignalConfigMercado(mercado.id),
      estrategia: estadoEstrategia,
      registros: executionJournal.registros,
    };
  });

  return ordenarMercadosParaInicio(mercados);
}

function obtenerTopIdsCanasta() {
  return seleccionarMercadosCanasta(obtenerMercadosRankeados(), signalConfig)
    .map(mercado => mercado.id);
}

function obtenerPuntuacionMercadoCanasta(mercadoId) {
  return obtenerMercadosRankeados()
    .find(mercado => mercado.id === mercadoId)?.puntuacion ?? null;
}

async function actualizarRankingAutomatico() {
  if (actualizacionRankingEnCurso) return;

  actualizacionRankingEnCurso = true;
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
  } finally {
    actualizacionRankingEnCurso = false;
  }
}

function actualizarMercadosTop() {
  navegarA('market-ranking-section');
  actualizarRankingAutomatico();
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

const orderAudit = createOrderAudit({
  storageKey: ORDER_AUDIT_STORAGE_KEY,
  onChange: renderAuditoriaOrdenes,
});

function claseEstadoSalud(estado) {
  if (estado === 'ok') return 'health-ok';
  if (estado === 'error') return 'health-error';
  return 'health-warn';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderProductionHealth() {
  const contenedor = document.getElementById('production-health');
  if (!contenedor) return;
  const mercados = Object.values(marketHealth);
  const ahora = Date.now();
  const activos = mercados.filter(item => item.estado === 'ok' && ahora - item.ultimoTick < 30000).length;
  const conProblemas = mercados.filter(item => item.estado === 'error' || ahora - (item.ultimoTick || 0) >= 30000).length;
  const total = Object.keys(mercadosActivos).length;
  productionHealth.mercados = total
    ? {
      estado: conProblemas ? 'warn' : 'ok',
      texto: `${activos}/${total} activos${conProblemas ? ` · ${conProblemas} revisar` : ''}`,
    }
    : { estado: 'warn', texto: 'Sin mercados abiertos' };
  const realAuto = modoEjecucion === 'real'
    ? { estado: 'ok', texto: 'Automático bloqueado' }
    : { estado: 'ok', texto: 'Real protegido' };
  const cards = [
    ['Deriv', productionHealth.deriv],
    ['Mercados', productionHealth.mercados],
    ['Portfolio', productionHealth.portfolio],
    ['Modo real', realAuto],
  ];
  contenedor.innerHTML = cards.map(([label, item]) => `
    <div class="health-card ${claseEstadoSalud(item.estado)}">
      <small>${label}</small>
      <b>${item.texto}</b>
    </div>
  `).join('');
}

function renderAlertasProduccion() {
  const contenedor = document.getElementById('alert-list');
  if (!contenedor) return;
  if (!alertasProduccion.length) {
    contenedor.innerHTML = '<div class="alert-item alert-item-info">Sin alertas recientes.</div>';
    return;
  }
  contenedor.innerHTML = alertasProduccion.slice(0, 6).map(alerta => `
    <div class="alert-item alert-item-${alerta.tipo}">
      ${escapeHtml(alerta.mensaje)}<br><small>${new Date(alerta.fecha).toLocaleTimeString()}</small>
    </div>
  `).join('');
}

function emitirAlerta(mensaje, tipo = 'info', { notificacion = false } = {}) {
  alertasProduccion.unshift({ mensaje, tipo, fecha: new Date().toISOString() });
  alertasProduccion.splice(20);
  renderAlertasProduccion();
  registrarLogAuto(mensaje, tipo);
  if (notificacion && 'Notification' in window && Notification.permission === 'granted') {
    new Notification('CBM Trading', { body: mensaje });
  }
}

function renderAuditoriaOrdenes(eventos = []) {
  const contenedor = document.getElementById('order-audit-feed');
  if (!contenedor) return;
  if (!eventos.length) {
    contenedor.innerHTML = '<div class="audit-item"><strong>Sin eventos auditados</strong><small>Los intentos de orden, cotizaciones, compras, errores y cierres aparecerán aquí.</small></div>';
    return;
  }
  contenedor.innerHTML = eventos.slice(0, 80).map(evento => `
    <div class="audit-item">
      <strong>${escapeHtml(evento.etapa)} · ${escapeHtml(evento.nombre || 'Orden')}${evento.contratoId ? ` · ${escapeHtml(evento.contratoId)}` : ''}</strong>
      <small>${new Date(evento.fecha).toLocaleString()} · ${escapeHtml(evento.modo || '—')} · ${escapeHtml(evento.origen || '—')}</small>
      <div>${escapeHtml(evento.detalle || '')}</div>
    </div>
  `).join('');
}

function limpiarAuditoriaOrdenes() {
  if (!confirm('¿Borrar la auditoría local de órdenes?')) return;
  orderAudit.limpiar();
  emitirAlerta('Auditoría de órdenes eliminada.', 'info');
}

function renderEstadoRiesgoGlobal() {
  const contenedor = document.getElementById('global-risk-status');
  if (!contenedor) return;
  const estado = globalRiskManager.estado(obtenerRegistrosParaRiesgo());
  const pausa = estado.pausado
    ? `Hasta ${new Date(estado.pausaHasta).toLocaleTimeString()}`
    : 'Disponible';
  const limitePosiciones = estado.config.maxPosicionesAbiertas > 0
    ? `${estado.posicionesAbiertas}/${estado.config.maxPosicionesAbiertas}`
    : `${estado.posicionesAbiertas}/sin límite`;
  contenedor.innerHTML = `
    <div class="summary-stat"><div class="summary-stat-label">Pérdida del día</div><div class="summary-stat-value">$${estado.perdidaDiaria.toFixed(2)}</div></div>
    <div class="summary-stat"><div class="summary-stat-label">Posiciones abiertas</div><div class="summary-stat-value">${limitePosiciones}</div></div>
    <div class="summary-stat"><div class="summary-stat-label">Pérdidas seguidas</div><div class="summary-stat-value">${estado.perdidasConsecutivas}/${estado.config.maxPerdidasConsecutivas}</div></div>
    <div class="summary-stat"><div class="summary-stat-label">Operativa</div><div class="summary-stat-value" style="font-size:13px">${pausa}</div></div>
  `;
}

function abrirConfiguracionRiesgo() {
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
  const cuentaActual = modoEjecucion === 'real' ? 'real' : 'demo';
  const mercadosPorContrato = contratosDerivMercadoPorCuenta[cuentaActual] || {};
  const idsRegistrados = new Set(
    executionJournal.registros
      .filter(item => item.estado === 'pendiente')
      .map(item => String(item.id)),
  );
  const posicionesExternas = (contratosDerivAbiertosPorCuenta[cuentaActual] || [])
    .filter(id => !idsRegistrados.has(String(id)))
    .map(id => ({ id, estado: 'pendiente', mercadoId: mercadosPorContrato[String(id)] || null }));
  return [...executionJournal.registros, ...posicionesExternas];
}

function validarAperturaPorRiesgo(riesgoOperacion, mercadoId = null) {
  return globalRiskManager.evaluar({
    registros: obtenerRegistrosParaRiesgo(),
    riesgoOperacion,
    mercadoId,
  });
}

function temaActual() {
  return document.body.dataset.theme === 'light' ? 'light' : 'dark';
}

function actualizarIndicadorModo() {
  const pill = document.getElementById('account-mode-pill');
  if (!pill) return;
  pill.classList.remove('mode-real', 'mode-demo', 'mode-simulacion');
  pill.classList.add(`mode-${modoEjecucion}`);
  pill.textContent = modoEjecucion === 'real'
    ? 'Cuenta real controlada'
    : modoEjecucion === 'demo'
      ? 'Cuenta demo real'
      : 'Simulación segura';
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

function cargarStrategyConfig() {
  try {
    const guardada = JSON.parse(localStorage.getItem(STRATEGY_CONFIG_STORAGE_KEY) || '{}');
    strategyConfig = normalizarStrategyConfig({ ...STRATEGY_CONFIG_DEFAULTS, ...guardada });
  } catch (error) {
    strategyConfig = { ...STRATEGY_CONFIG_DEFAULTS };
    console.error('No se pudo cargar la configuración de estrategia:', error);
  }
}

function solicitarPermisoNotificaciones() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  Notification.requestPermission().catch(() => {});
}

function notificarOportunidadFueraHorario({ mercadoId, nombre, tipo, puntuacion, entrada }) {
  if (!strategyConfig.notificarFueraHorario) return;
  const clave = `${mercadoId}:${tipo}`;
  const ahora = Date.now();
  if (ahora - (notificacionesOportunidad[clave] || 0) < 15 * 60 * 1000) return;
  notificacionesOportunidad[clave] = ahora;

  const mensaje = `${nombre} ${tipo}: calidad ${puntuacion}/100 fuera del horario. Entrada aprox. ${Number(entrada).toFixed(3)}.`;
  registrarLogAuto(`🔔 Oportunidad fuera de horario: ${mensaje}`, 'info');
  mostrarOportunidadFueraHorario({
    mercadoId,
    nombre,
    tipo,
    puntuacion,
    entrada,
  });

  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      new Notification('CBM Trading: oportunidad detectada', {
        body: `${mensaje} Confirma en la app si quieres invertir.`,
      });
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          new Notification('CBM Trading: oportunidad detectada', {
            body: `${mensaje} Confirma en la app si quieres invertir.`,
          });
        }
      }).catch(() => {});
    }
  }
}

function notificarOportunidadReal({ mercadoId, nombre, tipo, puntuacion, entrada }) {
  const clave = `real:${mercadoId}:${tipo}`;
  const ahora = Date.now();
  if (ahora - (notificacionesOportunidad[clave] || 0) < 15 * 60 * 1000) return;
  notificacionesOportunidad[clave] = ahora;

  const mensaje = `${nombre} ${tipo}: calidad ${puntuacion}/100 en observación real. Entrada aprox. ${Number(entrada).toFixed(3)}.`;
  registrarLogAuto(`🔔 Oportunidad real detectada: ${mensaje}`, 'info');
  mostrarOportunidadFueraHorario({
    mercadoId,
    nombre,
    tipo,
    puntuacion,
    entrada,
    origen: 'real_observe',
  });

  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      new Notification('CBM Trading: oportunidad real detectada', {
        body: `${mensaje} Revisa la app antes de confirmar dinero real.`,
      });
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          new Notification('CBM Trading: oportunidad real detectada', {
            body: `${mensaje} Revisa la app antes de confirmar dinero real.`,
          });
        }
      }).catch(() => {});
    }
  }
}

function mostrarOportunidadFueraHorario({ mercadoId, nombre, tipo, puntuacion, entrada, origen = 'offhours' }) {
  const mercado = mercadosActivos[mercadoId];
  const desviacion = Number(mercado?.desviacion) || 0;
  const sl = tipo === 'BUY' ? entrada - desviacion * 2 : entrada + desviacion * 2;
  const tp = tipo === 'BUY' ? entrada + desviacion * 3 : entrada - desviacion * 3;
  const inversion = calcularInversionSugerida();
  const objetivos = calcularObjetivosMonetarios(inversion);

  oportunidadFueraHorario = {
    mercadoId,
    nombre,
    tipo,
    puntuacion,
    entrada,
    sl,
    tp,
    inversion,
    riesgo: objetivos.riesgo,
    objetivo: objetivos.objetivo,
    modo: modoEjecucion,
    origen,
  };

  const esReal = modoEjecucion === 'real';
  const warning = document.getElementById('offhours-warning');
  const modeNote = document.getElementById('offhours-mode-note');
  if (warning) {
    warning.textContent = esReal
      ? 'La señal cumple la calidad configurada en cuenta real. La app NO invierte sola: revisa los datos y confirma manualmente solo si quieres usar dinero real.'
      : 'La señal cumple las reglas de calidad, pero apareció fuera del horario automático. La app no invierte sola: tú decides si quieres entrar ahora.';
  }
  if (modeNote) {
    modeNote.innerHTML = esReal
      ? 'Modo actual: <b id="offhours-mode">Cuenta real controlada</b>. Esta acción puede usar dinero real y requiere confirmación manual.'
      : 'Modo actual: <b id="offhours-mode">—</b>. Cambia el modo arriba antes de confirmar si quieres usar simulación o cuenta demo real.';
  }

  document.getElementById('offhours-market').textContent = nombre;
  document.getElementById('offhours-type').textContent = tipo;
  document.getElementById('offhours-quality').textContent = `${puntuacion}/100`;
  document.getElementById('offhours-entry').textContent = Number(entrada).toFixed(3);
  document.getElementById('offhours-sl').textContent = Number(sl).toFixed(3);
  document.getElementById('offhours-tp').textContent = Number(tp).toFixed(3);
  document.getElementById('offhours-stake').textContent = `$${inversion.toFixed(2)}`;
  document.getElementById('offhours-risk').textContent = `$${objetivos.riesgo.toFixed(2)}`;
  document.getElementById('offhours-target').textContent = `$${objetivos.objetivo.toFixed(2)}`;
  document.getElementById('offhours-mode').textContent = modoEjecucion === 'demo'
    ? 'Cuenta demo real'
    : modoEjecucion === 'real'
      ? 'Cuenta real controlada'
      : 'Simulación segura';
  document.getElementById('offhours-action').textContent = modoEjecucion === 'demo'
    ? 'Invertir ahora en demo'
    : modoEjecucion === 'real'
      ? 'Evaluar operación real'
      : 'Abrir simulación ahora';
  document.getElementById('offhours-modal').style.display = 'flex';
}

function cerrarOportunidadFueraHorario() {
  document.getElementById('offhours-modal').style.display = 'none';
}

function cerrarOportunidadFueraHorarioClick(event) {
  if (event.target.id === 'offhours-modal') cerrarOportunidadFueraHorario();
}

async function invertirOportunidadFueraHorario() {
  if (!oportunidadFueraHorario) return;
  const boton = document.getElementById('offhours-action');
  const oportunidad = oportunidadFueraHorario;
  if (boton) {
    boton.disabled = true;
    boton.textContent = 'Procesando...';
  }

  try {
    const ejecutada = await ejecutarOperacion(
      oportunidad.mercadoId,
      oportunidad.tipo,
      oportunidad.entrada,
      oportunidad.sl,
      oportunidad.tp,
      'offhours-action',
    );
    if (ejecutada) cerrarOportunidadFueraHorario();
  } finally {
    if (boton) {
      boton.disabled = false;
      boton.textContent = modoEjecucion === 'demo'
        ? 'Invertir ahora en demo'
        : modoEjecucion === 'real'
          ? 'Evaluar operación real'
          : 'Abrir simulación ahora';
    }
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
  document.getElementById('signal-threshold').value = signalConfig.umbralMinimo;
  document.getElementById('signal-confirmations').value = signalConfig.confirmacionesRequeridas;
  document.getElementById('signal-filter-auto').checked = signalConfig.filtrarAutoTrading;
  document.getElementById('basket-demo-enabled').checked = signalConfig.basketDemoEnabled;
  document.getElementById('basket-size').value = signalConfig.basketSize;
  document.getElementById('basket-min-quality').value = signalConfig.basketMinQuality;
  document.getElementById('basket-min-market-score').value = signalConfig.basketMinMarketScore;
  document.getElementById('basket-min-history').value = signalConfig.basketMinHistory;
  document.getElementById('basket-min-winrate').value = signalConfig.basketMinWinRate;
  document.getElementById('strategy-use-schedule').checked = strategyConfig.usarHorario;
  document.getElementById('strategy-start').value = strategyConfig.horaInicio;
  document.getElementById('strategy-end').value = strategyConfig.horaFin;
  document.getElementById('strategy-notify-offhours').checked = strategyConfig.notificarFueraHorario;
  document.getElementById('strategy-max-hour').value = strategyConfig.maxOperacionesHora;
  document.getElementById('strategy-max-day').value = strategyConfig.maxOperacionesDia;
  document.querySelectorAll('[data-strategy-day]').forEach(input => {
    input.checked = strategyConfig.diasPermitidos.includes(Number(input.value));
  });
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
    basketDemoEnabled: document.getElementById('basket-demo-enabled').checked,
    basketSize: document.getElementById('basket-size').value,
    basketMinQuality: document.getElementById('basket-min-quality').value,
    basketMinMarketScore: document.getElementById('basket-min-market-score').value,
    basketMinHistory: document.getElementById('basket-min-history').value,
    basketMinWinRate: document.getElementById('basket-min-winrate').value,
  });
  strategyConfig = normalizarStrategyConfig({
    usarHorario: document.getElementById('strategy-use-schedule').checked,
    horaInicio: document.getElementById('strategy-start').value,
    horaFin: document.getElementById('strategy-end').value,
    diasPermitidos: Array.from(document.querySelectorAll('[data-strategy-day]:checked'))
      .map(input => Number(input.value)),
    notificarFueraHorario: document.getElementById('strategy-notify-offhours').checked,
    maxOperacionesHora: document.getElementById('strategy-max-hour').value,
    maxOperacionesDia: document.getElementById('strategy-max-day').value,
  });
  localStorage.setItem(SIGNAL_CONFIG_STORAGE_KEY, JSON.stringify(signalConfig));
  localStorage.setItem(STRATEGY_CONFIG_STORAGE_KEY, JSON.stringify(strategyConfig));
  cerrarConfiguracionSenales();
  if (strategyConfig.notificarFueraHorario) solicitarPermisoNotificaciones();
  registrarLogAuto(
    `Estrategia actualizada: mínimo ${signalConfig.umbralMinimo}/100, ${signalConfig.confirmacionesRequeridas} confirmaciones, canasta demo ${signalConfig.basketDemoEnabled ? 'activa' : 'inactiva'}, horario ${strategyConfig.usarHorario ? `${strategyConfig.horaInicio}-${strategyConfig.horaFin}` : 'sin restricción'}.`,
    'success',
  );
  if (signalConfig.basketDemoEnabled) prepararCanastaDemoAutomatica();
}

function eliminarCalibracionMercado(mercadoId) {
  marketCalibrationStore.eliminar(mercadoId);
  renderCalibracionesMercado();
  renderRankingMercados();
  registrarLogAuto(`${NOMBRES_SIMBOLOS[mercadoId] || mercadoId}: calibración eliminada.`, 'info');
}

function abrirBacktesting() {
  document.getElementById('backtest-modal').style.display = 'flex';
}

function cerrarBacktesting() {
  document.getElementById('backtest-modal').style.display = 'none';
}

function cerrarBacktestingClick(event) {
  if (event.target.id === 'backtest-modal') cerrarBacktesting();
}

function dinero(value, signo = false) {
  const n = Number(value) || 0;
  const prefijo = signo && n >= 0 ? '+' : n < 0 ? '-' : '';
  return `${prefijo}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderItemEvaluacion(label, item, empty = 'Sin datos') {
  if (!item) {
    return `<div class="opportunity-item"><small>${label}</small><b>${empty}</b></div>`;
  }
  return `
    <div class="opportunity-item">
      <small>${label}</small>
      <b>${item.key}</b>
      <div class="market-ranking-note" style="margin:4px 0 0">${item.total} ops · ${item.winRate.toFixed(1)}% · ${dinero(item.pnl, true)}</div>
    </div>
  `;
}

function abrirEvaluacionSemanal() {
  const evaluacion = evaluarSemanaTrading({
    registros: executionJournal.registros,
    now: new Date(),
    dias: 7,
  });
  const estadoRiesgo = globalRiskManager.estado(obtenerRegistrosParaRiesgo());
  const preparacion = evaluarPreparacionReal({
    evaluacion,
    registros: executionJournal.registros,
    configRiesgo: estadoRiesgo.config,
  });

  document.getElementById('weekly-summary').innerHTML = `
    <div class="summary-stat"><div class="summary-stat-label">Operaciones 7 días</div><div class="summary-stat-value">${evaluacion.total}</div></div>
    <div class="summary-stat"><div class="summary-stat-label">Win rate</div><div class="summary-stat-value">${evaluacion.total ? `${evaluacion.winRate.toFixed(1)}%` : '—'}</div></div>
    <div class="summary-stat"><div class="summary-stat-label">P&L neto</div><div class="summary-stat-value" style="color:${evaluacion.pnl >= 0 ? '#26a69a' : '#ef5350'}">${dinero(evaluacion.pnl, true)}</div></div>
    <div class="summary-stat"><div class="summary-stat-label">Pérdida acumulada</div><div class="summary-stat-value" style="color:#ef5350">${dinero(evaluacion.perdidaAcumulada)}</div></div>
    <div class="summary-stat"><div class="summary-stat-label">Drawdown máx.</div><div class="summary-stat-value" style="color:#ef5350">${dinero(evaluacion.maxDrawdown)}</div></div>
    <div class="summary-stat"><div class="summary-stat-label">Peor racha</div><div class="summary-stat-value">${evaluacion.peorRacha}</div></div>
  `;

  document.getElementById('weekly-highlights').innerHTML = `
    ${renderItemEvaluacion('Mejor mercado', evaluacion.mejorMercado)}
    ${renderItemEvaluacion('Peor mercado', evaluacion.peorMercado)}
    ${renderItemEvaluacion('Mejor horario', evaluacion.mejorHorario)}
  `;

  document.getElementById('real-readiness-status').innerHTML = `
    <div class="opportunity-warning" style="border-color:${preparacion.listo ? 'rgba(38,166,154,.45)' : 'rgba(255,176,32,.4)'};background:${preparacion.listo ? 'rgba(38,166,154,.1)' : 'rgba(255,176,32,.1)'}">
      <b>${preparacion.estado}</b><br>
      Checklist: ${preparacion.aprobadas}/${preparacion.total}. Esta sección no autoriza operar real; solo indica si la prueba demo ya tiene evidencia suficiente.
    </div>
  `;
  document.getElementById('real-readiness-checks').innerHTML = preparacion.checks.map(check => `
    <div class="readiness-check ${check.ok ? 'readiness-ok' : 'readiness-pending'}">
      <span>${check.ok ? '✓' : '!'}</span>
      <div><b>${check.label}</b><small>${check.detalle}</small></div>
    </div>
  `).join('');

  document.getElementById('weekly-evaluation-modal').style.display = 'flex';
}

function cerrarEvaluacionSemanal() {
  document.getElementById('weekly-evaluation-modal').style.display = 'none';
}

function cerrarEvaluacionSemanalClick(event) {
  if (event.target.id === 'weekly-evaluation-modal') cerrarEvaluacionSemanal();
}

function limpiarRegistroEjecuciones() {
  if (!confirm('¿Borrar todo el registro de ejecuciones?')) return;
  executionJournal.limpiar();
  registrarLogAuto('Registro de ejecuciones eliminado.', 'info');
}

function alternarRegistroEjecuciones() {
  const modal = document.getElementById('execution-modal');
  const boton = document.getElementById('execution-toggle');
  if (!modal) return;

  modal.style.display = 'flex';
  boton?.setAttribute('aria-expanded', 'true');
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
  loading.textContent = `Cargando gráfico en vivo de ${nombre}...`;
  document.getElementById('position-chart-title').textContent = `${nombre} · gráfico en vivo`;

  detenerGraficoPosicionEnVivo();

  try {
    const ticks = await obtenerTicksHistoricos(mercadoId, 120);
    if (!ticks.length) throw new Error('No hay precios históricos disponibles');
    const ticksEnVivo = [...ticks];
    let ultimoPrecio = ticksEnVivo[ticksEnVivo.length - 1]?.precio ?? null;
    loading.style.display = 'none';
    contenedor.style.display = 'block';
    positionChart = createPositionChart({
      contenedor,
      ticks: ticksEnVivo,
      chartTheme: TEMAS[temaActual()],
    });
    iniciarGraficoPosicionEnVivo({ mercadoId, nombre, ticks: ticksEnVivo, getUltimoPrecio: () => ultimoPrecio, setUltimoPrecio: value => { ultimoPrecio = value; } });
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    contenedor.style.display = 'none';
    loading.style.display = 'block';
    loading.textContent = `No se pudo cargar el gráfico: ${mensajeAmigableError(error)}`;
  }
}

async function iniciarGraficoPosicionEnVivo({ mercadoId, nombre, ticks, getUltimoPrecio, setUltimoPrecio }) {
  const loading = document.getElementById('position-chart-loading');
  try {
    const wsUrl = await obtenerWsUrl(modoEjecucion === 'real' ? 'real' : 'demo');
    positionChartWs = crearWebSocket(wsUrl, {
      onOpen: ws => suscribirTicks(ws, mercadoId),
      onMessage: msg => {
        if (msg.error) {
          if (loading) {
            loading.style.display = 'block';
            loading.textContent = `Gráfico en vivo pausado: ${mensajeAmigableError(msg.error.message)}`;
          }
          return;
        }
        if (msg.tick?.quote) setUltimoPrecio(Number(msg.tick.quote));
      },
      onError: () => {
        if (loading) {
          loading.style.display = 'block';
          loading.textContent = `No se pudo mantener el gráfico en vivo de ${nombre}.`;
        }
      },
    });

    positionChartTimer = setInterval(() => {
      const precio = getUltimoPrecio();
      if (!Number.isFinite(precio) || !positionChart) return;
      const epoch = Math.floor(Date.now() / 60000) * 60;
      const ultimo = ticks[ticks.length - 1];
      if (ultimo?.epoch === epoch) {
        ultimo.precio = precio;
      } else {
        ticks.push({ epoch, precio });
        if (ticks.length > 180) ticks.shift();
      }
      positionChart.update(ticks);
    }, 60000);
  } catch (error) {
    if (loading) {
      loading.style.display = 'block';
      loading.textContent = `No se pudo iniciar el gráfico en vivo: ${mensajeAmigableError(error)}`;
    }
  }
}

function detenerGraficoPosicionEnVivo() {
  if (positionChartTimer) {
    clearInterval(positionChartTimer);
    positionChartTimer = null;
  }
  if (positionChartWs) {
    positionChartWs.close();
    positionChartWs = null;
  }
  if (positionChart) {
    positionChart.remove();
    positionChart = null;
  }
}

function cerrarGraficoPosicion() {
  detenerGraficoPosicionEnVivo();
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
  if (modo === 'real') {
    const aceptar = confirm(
      'Activar Cuenta real controlada requiere dinero real.\n\n'
      + 'Reglas de seguridad:\n'
      + '- Solo operaciones manuales.\n'
      + '- Máximo $2 por operación.\n'
      + '- Automático bloqueado.\n'
      + '- Debes confirmar cada orden.\n\n'
      + '¿Quieres activar este modo?',
    );
    if (!aceptar) {
      document.getElementById('execution-mode').value = modoEjecucion;
      return;
    }
  }
  modoEjecucion = ['demo', 'real'].includes(modo) ? modo : 'simulacion';
  if (modoEjecucion === 'real') {
    Object.keys(mercadosActivos).forEach(id => {
      autoTrader.toggle(id, false);
      const checkbox = document.querySelector(`#card-${id} input[type="checkbox"]`);
      if (checkbox) checkbox.checked = false;
      actualizarPanelAutomatico(id, { activo: false, estadoForzado: null });
    });
  }
  registrarLogAuto(
    modoEjecucion === 'real'
      ? 'Cuenta real controlada activada. Automático bloqueado y monto máximo $2.'
      : modoEjecucion === 'demo'
        ? 'Modo cuenta demo real activado. Las próximas ejecuciones enviarán órdenes a Deriv demo.'
        : 'Modo simulación segura activado. No se enviarán órdenes a Deriv.',
    modoEjecucion === 'real' || modoEjecucion === 'demo' ? 'error' : 'success'
  );
  emitirAlerta(
    modoEjecucion === 'real'
      ? 'Cuenta real controlada activada: automático bloqueado y confirmación fuerte habilitada.'
      : modoEjecucion === 'demo'
        ? 'Cuenta demo real activada.'
        : 'Simulación segura activada.',
    modoEjecucion === 'real' ? 'warning' : 'info',
  );
  if (modoEjecucion === 'real') solicitarPermisoNotificaciones();
  actualizarIndicadorModo();
  renderResumenEjecuciones(executionJournal.registros);
  actualizarSaldo();
  cargarPortfolio();
  if (modoEjecucion === 'demo' && signalConfig.basketDemoEnabled) {
    prepararCanastaDemoAutomatica({ silencioso: true });
  }
}

function revisarSaludMercados() {
  const ahora = Date.now();
  Object.entries(mercadosActivos).forEach(([id, mercado]) => {
    const estado = marketHealth[id];
    if (!estado?.ultimoTick) return;
    const sinTicksMs = ahora - estado.ultimoTick;
    if (sinTicksMs > 45000 && estado.estado !== 'error') {
      marketHealth[id] = {
        estado: 'warn',
        ultimoTick: estado.ultimoTick,
        texto: `Sin ticks ${Math.round(sinTicksMs / 1000)}s`,
      };
      emitirAlerta(`${mercado.nombre}: sin ticks recientes. Revisando conexión.`, 'warning');
    }
  });
  renderProductionHealth();
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
  const cuentaActual = modoEjecucion === 'real' ? 'real' : 'demo';
  const labelSaldo = document.getElementById('hist-balance-label');
  if (labelSaldo) labelSaldo.textContent = cuentaActual === 'real' ? 'Saldo real' : 'Saldo demo';
  const saldoEl = document.getElementById('hist-saldo-sim');
  const saldoInicial = saldosInicialesPorCuenta[cuentaActual];
  saldoEl.textContent = '$' + saldoReal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
  saldoEl.style.color = saldoInicial === null ? 'var(--text-primary)' : (saldoReal >= saldoInicial ? '#26a69a' : '#ef5350');
  renderResumenEjecuciones(executionJournal?.registros || []);
}

async function actualizarSaldo() {
  actualizarIndicadorModo();
  const labelSaldo = document.getElementById('balance-label');
  if (labelSaldo) {
    labelSaldo.textContent = modoEjecucion === 'real' ? 'Saldo real (Deriv):' : 'Saldo demo (Deriv):';
  }
  try {
    const data = await obtenerCuenta(modoEjecucion === 'real' ? 'real' : 'demo');
    const el = document.getElementById('balance-value');
    if (data.accountId) {
      productionHealth.deriv = { estado: 'ok', texto: `${data.accountId} conectado` };
      const cuentaActual = modoEjecucion === 'real' ? 'real' : 'demo';
      saldoReal = parseFloat(data.balance);
      riskManager.setSaldo(saldoReal);
      if (saldosInicialesPorCuenta[cuentaActual] === null) saldosInicialesPorCuenta[cuentaActual] = saldoReal;
      const balance = saldoReal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
      el.textContent = `$${balance} ${data.currency}`;
      actualizarStatsBalance();
    } else {
      el.textContent = 'No disponible';
      productionHealth.deriv = { estado: 'warn', texto: 'Cuenta no disponible' };
    }
  } catch (e) {
    document.getElementById('balance-value').textContent = 'Error';
    productionHealth.deriv = { estado: 'error', texto: 'Error de conexión' };
    emitirAlerta(`Deriv: ${mensajeAmigableError(e)}`, 'error');
  } finally {
    renderProductionHealth();
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

function obtenerMercadoIdContrato(contrato = {}) {
  const directo = contrato.underlying || contrato.symbol;
  if (directo && NOMBRES_SIMBOLOS[directo]) return directo;
  const simboloShortcode = parseShortcode(contrato.shortcode || '').simbolo;
  return NOMBRES_SIMBOLOS[simboloShortcode] ? simboloShortcode : null;
}

function formatearDuracion(segundos) {
  const total = Math.max(0, Math.floor(Number(segundos) || 0));
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const segs = total % 60;
  if (horas > 0) return `${horas}h ${String(minutos).padStart(2, '0')}m`;
  return `${minutos}m ${String(segs).padStart(2, '0')}s`;
}

function actualizarContadoresPosiciones() {
  const ahora = Math.floor(Date.now() / 1000);
  document.querySelectorAll('.position-card[data-open-time], .position-card[data-expiry-time]').forEach(card => {
    const abiertaEn = Number(card.dataset.openTime);
    const cierraEn = Number(card.dataset.expiryTime);
    const abiertaEl = card.querySelector('.pos-open-elapsed');
    const cierreEl = card.querySelector('.pos-expiry-countdown');
    const revisionEl = card.querySelector('.pos-fee-review');

    if (abiertaEl && Number.isFinite(abiertaEn) && abiertaEn > 0) {
      abiertaEl.textContent = formatearDuracion(ahora - abiertaEn);
    }

    if (cierreEl) {
      cierreEl.classList.remove('timer-warn', 'timer-danger');
      if (Number.isFinite(cierraEn) && cierraEn > 0) {
        const restante = cierraEn - ahora;
        cierreEl.textContent = restante > 0 ? formatearDuracion(restante) : 'Cerrando/expirada';
        if (restante <= 60) cierreEl.classList.add('timer-danger');
        else if (restante <= 5 * 60) cierreEl.classList.add('timer-warn');
      } else {
        cierreEl.textContent = 'Sin vencimiento fijo';
      }
    }

    if (revisionEl) {
      revisionEl.classList.remove('timer-warn');
      if (Number.isFinite(abiertaEn) && abiertaEn > 0) {
        const transcurrido = ahora - abiertaEn;
        const restanteRevision = FEE_REVIEW_INTERVAL_SECONDS - (transcurrido % FEE_REVIEW_INTERVAL_SECONDS);
        revisionEl.textContent = formatearDuracion(restanteRevision);
        if (restanteRevision <= 5 * 60) revisionEl.classList.add('timer-warn');
      } else {
        revisionEl.textContent = '—';
      }
    }
  });
}

function crearTarjetaPosicion(contrato) {
  const contractId = contrato.contract_id;
  const { tipo, simbolo, multiplier } = parseShortcode(contrato.shortcode);
  const registro = executionJournal.obtener(contractId);
  const mercadoId = registro?.mercadoId
    || obtenerMercadoIdContrato(contrato)
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
  actualizarContadoresPosiciones();
}

function actualizarTarjetaPosicion(c) {
  const el = document.getElementById(`pos-${c.contract_id}`);
  if (c.is_sold) {
    const cuentaActual = modoEjecucion === 'real' ? 'real' : 'demo';
    contratosDerivAbiertosPorCuenta[cuentaActual] = contratosDerivAbiertosPorCuenta[cuentaActual].filter(
      id => String(id) !== String(c.contract_id),
    );
    delete contratosDerivMercadoPorCuenta[cuentaActual][String(c.contract_id)];
    const costos = extraerCostosReportados(c);
    const cerrado = executionJournal.cerrar(c.contract_id, {
      pnlNeto: c.profit,
      costos,
      pnlBruto: costos === null ? null : Number(c.profit) + costos,
    });
    if (cerrado) {
      delete cargosReportadosPorContrato[c.contract_id];
      orderAudit.registrar({
        etapa: 'cierre detectado',
        nivel: Number(c.profit) >= 0 ? 'success' : 'error',
        modo: cuentaActual,
        contratoId: c.contract_id,
        mercadoId: obtenerMercadoIdContrato(c),
        detalle: `Contrato cerrado con P&L ${Number(c.profit) >= 0 ? '+' : ''}$${Number(c.profit || 0).toFixed(2)}.`,
        datos: { profit: c.profit, costos },
      });
      emitirAlerta(
        `Contrato ${c.contract_id} cerrado: ${Number(c.profit) >= 0 ? '+' : ''}$${Number(c.profit || 0).toFixed(2)}.`,
        Number(c.profit) >= 0 ? 'success' : 'error',
        { notificacion: true },
      );
    }
    renderResumenEjecuciones(executionJournal.registros);
  }
  if (!el) return;

  const abiertaEn = obtenerTimestampContrato(c, [
    'purchase_time', 'date_start', 'start_time', 'transaction_time',
  ]);
  const cierraEn = obtenerTimestampContrato(c, [
    'date_expiry', 'expiry_time', 'sell_time',
  ]);
  if (abiertaEn) el.dataset.openTime = String(abiertaEn);
  if (cierraEn) el.dataset.expiryTime = String(cierraEn);

  const costosAbiertos = extraerCostosReportados(c);
  if (costosAbiertos !== null && cargosReportadosPorContrato[c.contract_id] !== costosAbiertos) {
    cargosReportadosPorContrato[c.contract_id] = costosAbiertos;
    orderAudit.registrar({
      etapa: 'costos reportados',
      nivel: 'warning',
      modo: modoEjecucion === 'real' ? 'real' : 'demo',
      contratoId: c.contract_id,
      mercadoId: obtenerMercadoIdContrato(c),
      detalle: `Deriv reporta cargos/costos acumulados por $${costosAbiertos.toFixed(2)} en esta posición.`,
      datos: { costos: costosAbiertos },
    });
    emitirAlerta(`Contrato ${c.contract_id}: Deriv reporta costos por $${costosAbiertos.toFixed(2)}.`, 'warning');
  }

  const mercadoId = obtenerMercadoIdContrato(c);
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
      const etiquetaCuenta = modoEjecucion === 'real' ? 'cuenta real controlada' : 'cuenta demo real';
      contenedor.innerHTML = `<div class="positions-empty">No hay posiciones abiertas en ${etiquetaCuenta}.</div>`;
    }
    actualizarSaldo();
  } else {
    statusEl.textContent = 'Abierto';
  }
}

function idsPendientesNoAbiertosPorCuenta(cuenta) {
  const abiertos = new Set((contratosDerivAbiertosPorCuenta[cuenta] || []).map(id => String(id)));
  return executionJournal.registros
    .filter(item => item.modo === cuenta && item.estado === 'pendiente')
    .map(item => String(item.id))
    .filter(id => !abiertos.has(id));
}

function notificarReconciliacion(cerradas) {
  if (!cerradas.length) return;
  const ganadas = cerradas.filter(item => item.pnl >= 0).length;
  const perdidas = cerradas.length - ganadas;
  const mensaje = `Reconciliación Deriv: ${cerradas.length} cierre(s) detectado(s), ${ganadas} ganada(s), ${perdidas} perdida(s).`;
  registrarLogAuto(mensaje, perdidas ? 'error' : 'success');

  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('CBM Trading: cierres actualizados', { body: mensaje });
  }
}

async function reconciliarConDeriv() {
  await cargarPortfolio({ manual: true });
}

async function cargarPortfolio({ manual = false } = {}) {
  const contenedor = document.getElementById('real-positions');
  const titulo = document.getElementById('real-positions-title');
  const cuentaActual = modoEjecucion === 'real' ? 'real' : 'demo';
  const etiquetaCuenta = cuentaActual === 'real' ? 'Cuenta real controlada' : 'Cuenta demo real';
  if (titulo) titulo.textContent = etiquetaCuenta;
  const boton = document.getElementById('btn-reconcile-deriv');
  if (boton) {
    boton.disabled = true;
    boton.textContent = manual ? 'Reconciliando...' : 'Actualizando...';
  }
  contenedor.innerHTML = `<div class="positions-empty">Cargando posiciones de ${etiquetaCuenta.toLowerCase()}...</div>`;

  try {
    const wsUrl = await obtenerWsUrl(cuentaActual);
    if (portfolioWs) {
      portfolioWs.cierreEsperado = true;
      portfolioWs.close();
    }
    const cierresDetectados = [];
    const pendientesConsultados = new Set();
    portfolioWs = crearWebSocket(wsUrl, {
      onOpen: ws => solicitarPortfolio(ws),
      onMessage: msg => {
      if (msg.error) {
        if (pendientesConsultados.has(String(msg.echo_req?.contract_id))) {
          pendientesConsultados.delete(String(msg.echo_req.contract_id));
          if (manual && pendientesConsultados.size === 0) {
            registrarLogAuto('Reconciliación Deriv completa: algunos contratos pendientes ya no están abiertos.', 'info');
          }
          return;
        }
        productionHealth.portfolio = { estado: 'error', texto: mensajeAmigableError(msg.error.message) };
        renderProductionHealth();
        contenedor.innerHTML = `<div class="positions-empty">Error: ${mensajeAmigableError(msg.error.message)}</div>`;
        emitirAlerta(`Portfolio: ${mensajeAmigableError(msg.error.message)}`, 'error');
        return;
      }

      if (msg.portfolio) {
        const contratos = msg.portfolio.contracts || [];
        productionHealth.portfolio = { estado: 'ok', texto: `${contratos.length} abiertas` };
        renderProductionHealth();
        contratosDerivAbiertosPorCuenta[cuentaActual] = contratos.map(c => c.contract_id);
        contratosDerivMercadoPorCuenta[cuentaActual] = Object.fromEntries(
          contratos
            .map(c => [String(c.contract_id), obtenerMercadoIdContrato(c)])
            .filter(([, mercadoId]) => Boolean(mercadoId)),
        );
        renderResumenEjecuciones(executionJournal.registros);
        renderEstadoRiesgoGlobal();
        const pendientes = idsPendientesNoAbiertosPorCuenta(cuentaActual);
        if (contratos.length === 0) {
          contenedor.innerHTML = `<div class="positions-empty">No hay posiciones abiertas en ${etiquetaCuenta.toLowerCase()}.</div>`;
        } else {
          contenedor.innerHTML = '';
          contratos.forEach(c => {
            crearTarjetaPosicion(c);
            suscribirContrato(portfolioWs, c.contract_id);
          });
        }
        pendientes.forEach(id => {
          pendientesConsultados.add(String(id));
          solicitarContratoEstado(portfolioWs, id);
        });
        if (manual && !pendientes.length) {
          registrarLogAuto('Reconciliación Deriv completa: no hay cierres pendientes por actualizar.', 'success');
        }
      }

      if (msg.proposal_open_contract) {
        const contrato = msg.proposal_open_contract;
        const mercadoContrato = obtenerMercadoIdContrato(contrato);
        if (mercadoContrato) contratosDerivMercadoPorCuenta[cuentaActual][String(contrato.contract_id)] = mercadoContrato;
        if (contrato.is_sold) {
          const pnl = Number(contrato.profit) || 0;
          cierresDetectados.push({ id: contrato.contract_id, pnl });
        }
        pendientesConsultados.delete(String(contrato.contract_id));
        actualizarTarjetaPosicion(msg.proposal_open_contract);
        if (manual && pendientesConsultados.size === 0) {
          notificarReconciliacion(cierresDetectados);
          if (!cierresDetectados.length) {
            registrarLogAuto('Reconciliación Deriv completa: posiciones y métricas actualizadas.', 'success');
          }
        }
      }

      if (msg.sell) {
        cargarPortfolio({ manual: false });
        actualizarSaldo();
      }
      },
      onError: (_event, ws) => {
        if (ws?.cierreEsperado) return;
        productionHealth.portfolio = { estado: 'error', texto: 'Error de conexión' };
        renderProductionHealth();
        emitirAlerta('Portfolio: error de conexión con Deriv.', 'error');
        contenedor.innerHTML = '<div class="positions-empty">Error de conexión con Deriv.</div>';
      },
      onClose: (_event, ws) => {
        if (ws?.cierreEsperado) return;
        if (productionHealth.portfolio.estado !== 'error') {
          productionHealth.portfolio = { estado: 'ok', texto: 'Actualizado' };
          renderProductionHealth();
        }
      },
    });
  } catch (error) {
    productionHealth.portfolio = { estado: 'error', texto: mensajeAmigableError(error) };
    renderProductionHealth();
    emitirAlerta(`Portfolio: ${mensajeAmigableError(error)}`, 'error');
    contenedor.innerHTML = `<div class="positions-empty">Error en ${etiquetaCuenta}: ${mensajeAmigableError(error)}</div>`;
  } finally {
    if (boton) {
      boton.disabled = false;
      boton.textContent = 'Reconciliar con Deriv';
    }
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
    emitirAlerta('Reconectando portfolio, intenta cerrar la operación en un momento.', 'warning');
    alert('Reconectando, intenta de nuevo en un momento.');
    return;
  }
  orderAudit.registrar({
    etapa: 'cierre solicitado',
    nivel: 'warning',
    modo: modoEjecucion === 'real' ? 'real' : 'demo',
    contratoId: contractId,
    detalle: 'Solicitud manual de cierre enviada a Deriv.',
  });
  emitirAlerta(`Cierre solicitado para contrato ${contractId}.`, 'warning');
  cerrarContrato(portfolioWs, contractId);
}

function confirmarOperacionReal({ nombre, tipo, stake, objetivos, entrada, sl, tp, cotizacion }) {
  const frase = 'REAL';
  const detalle =
    `CONFIRMACIÓN DE DINERO REAL\n\n`
    + `Mercado: ${nombre}\n`
    + `Tipo: ${tipo}\n`
    + `Inversión: $${stake.toFixed(2)}\n`
    + `Precio cotizado: $${cotizacion.precioCotizado?.toFixed(2) ?? '—'}\n`
    + `Multiplicador aceptado: x${cotizacion.multiplicador ?? '—'}\n`
    + `Riesgo máximo: $${objetivos.riesgo.toFixed(2)}\n`
    + `Objetivo de ganancia: $${objetivos.objetivo.toFixed(2)}\n`
    + `Entrada: ${entrada.toFixed(2)}\n`
    + `Stop Loss: ${sl.toFixed(2)}\n`
    + `Take Profit: ${tp.toFixed(2)}\n\n`
    + `Para enviar esta orden escribe exactamente: ${frase}`;
  const respuesta = prompt(detalle);
  if (respuesta === null) return false;
  return respuesta.trim().toUpperCase() === frase;
}

async function ejecutarOperacion(mercadoId, tipo, entrada, sl, tp, btnId) {
  const stake = calcularInversionSugerida();
  const objetivos = calcularObjetivosMonetarios(stake);
  const nombre = NOMBRES_SIMBOLOS[mercadoId] || mercadoId;
  const evaluacionRiesgo = validarAperturaPorRiesgo(objetivos.riesgo, mercadoId);
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
  const accountMode = modoEjecucion === 'real' ? 'real' : 'demo';
  orderAudit.registrar({
    etapa: 'intento manual',
    nivel: accountMode === 'real' ? 'warning' : 'info',
    modo: accountMode,
    mercadoId,
    nombre,
    tipo,
    origen: 'manual',
    stake,
    riesgo: objetivos.riesgo,
    objetivo: objetivos.objetivo,
    detalle: `Preparando orden manual en ${etiquetaModoOperacion()}.`,
    datos: { entrada, sl, tp },
  });

  try {
    let cotizacionAceptada = false;
    let cotizacionRechazada = false;
    const resultado = await ejecutarOrdenDemo({
      mercadoId, tipo, stake, entrada, sl, tp, accountMode,
    }, {
      confirmarCotizacion: cotizacion => {
        if (cotizacionAceptada) return true;
        if (cotizacionRechazada) return false;
        orderAudit.registrar({
          etapa: 'cotización recibida',
          nivel: accountMode === 'real' ? 'warning' : 'info',
          modo: accountMode,
          mercadoId,
          nombre,
          tipo,
          origen: 'manual',
          stake,
          riesgo: objetivos.riesgo,
          objetivo: objetivos.objetivo,
          detalle: `Cotización recibida: $${cotizacion.precioCotizado?.toFixed(2) ?? '—'} · x${cotizacion.multiplicador ?? '—'}.`,
          datos: cotizacion,
        });
        const detalle =
        `Confirmar operación en ${etiquetaModoOperacion()}:\n\n`
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
        + (modoEjecucion === 'real'
          ? 'Para enviar dinero real escribe REAL en la siguiente ventana.'
          : '¿Ejecutar esta operación ahora?');
        const aceptada = modoEjecucion !== 'real'
          ? confirm(detalle)
          : confirmarOperacionReal({ nombre, tipo, stake, objetivos, entrada, sl, tp, cotizacion });
        cotizacionAceptada = aceptada;
        cotizacionRechazada = !aceptada;
        return aceptada;
      },
    });
      if (resultado.cancelada) {
        orderAudit.registrar({
          etapa: 'orden cancelada',
          nivel: accountMode === 'real' ? 'warning' : 'info',
          modo: accountMode,
          mercadoId,
          nombre,
          tipo,
          origen: 'manual',
          stake,
          detalle: 'La cotización fue cancelada antes de comprar.',
          datos: resultado.cotizacion,
        });
        if (accountMode === 'real') {
          emitirAlerta('Orden real cancelada: la confirmación no coincidió o fue cerrada antes de comprar.', 'warning');
          alert('Orden real cancelada. No se envió dinero real.\n\nPara confirmar debes escribir REAL.');
        }
        return false;
      }
      const { compra, multiplicador, cotizacion } = resultado;
      orderAudit.registrar({
        etapa: 'compra aceptada',
        nivel: accountMode === 'real' ? 'warning' : 'success',
        modo: accountMode,
        mercadoId,
        nombre,
        tipo,
        origen: 'manual',
        contratoId: compra.contract_id,
        stake,
        riesgo: objetivos.riesgo,
        objetivo: objetivos.objetivo,
        detalle: `Orden aceptada por Deriv. Compra $${compra.buy_price}. Saldo posterior $${compra.balance_after}.`,
        datos: { compra, cotizacion, multiplicador },
      });
      executionJournal.abrir({
        id: compra.contract_id,
        mercadoId,
        nombre,
        tipo,
        modo: accountMode,
        origen: 'manual',
        stake,
        entrada,
        multiplicador: cotizacion.multiplicador ?? multiplicador,
        precioCotizado: cotizacion.precioCotizado,
        costosReportados: cotizacion.costosReportados,
        stopLossAmount: objetivos.riesgo,
        takeProfitAmount: objetivos.objetivo,
      });
      emitirAlerta(
        `${nombre} ${tipo} ejecutado en ${etiquetaModoOperacion()} · contrato ${compra.contract_id}.`,
        accountMode === 'real' ? 'warning' : 'success',
        { notificacion: true },
      );
      alert(`✅ Operación ejecutada en ${etiquetaModoOperacion()}\n\nContrato: ${compra.contract_id}\nPrecio compra: $${compra.buy_price}\nMultiplicador: x${multiplicador}\nSaldo restante: $${compra.balance_after}`);
      actualizarSaldo();
      cargarPortfolio();
      return true;
  } catch (error) {
    orderAudit.registrar({
      etapa: 'error de orden',
      nivel: 'error',
      modo: accountMode,
      mercadoId,
      nombre,
      tipo,
      origen: 'manual',
      stake,
      detalle: mensajeAmigableError(error),
    });
    emitirAlerta(`${nombre} ${tipo}: ${mensajeAmigableError(error)}`, 'error', { notificacion: true });
    alert(`❌ Error: ${mensajeAmigableError(error)}`);
    return false;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = modoEjecucion === 'real' ? 'Ejecutar real controlado' : 'Ejecutar en demo'; }
  }
}

async function ejecutarOperacionAutomaticaCore(mercadoId, tipo, entrada, sl, tp, opciones = {}) {
  if (modoEjecucion === 'real') {
    throw new Error('El automático está bloqueado en Cuenta real controlada.');
  }
  const stake = calcularInversionSugerida();
  const objetivos = calcularObjetivosMonetarios(stake);
  const nombre = NOMBRES_SIMBOLOS[mercadoId] || mercadoId;
  const evaluacionRiesgo = validarAperturaPorRiesgo(objetivos.riesgo, mercadoId);
  if (!evaluacionRiesgo.permitido) {
    renderEstadoRiesgoGlobal();
    throw new Error(`Bloqueada por riesgo: ${evaluacionRiesgo.motivo}`);
  }
  if (modoEjecucion === 'simulacion') {
    abrirPosicionSimulada(mercadoId, tipo, entrada, sl, tp, 'automatica');
    return true;
  }

  orderAudit.registrar({
    etapa: 'intento automático',
    nivel: 'info',
    modo: 'demo',
    mercadoId,
    nombre,
    tipo,
    origen: opciones.tipoEjecucion === 'canasta_3x' ? 'canasta_3x' : 'automatica',
    stake,
    riesgo: objetivos.riesgo,
    objetivo: objetivos.objetivo,
    detalle: 'Preparando orden automática en cuenta demo.',
    datos: { entrada, sl, tp },
  });
  registrarLogAuto(`${nombre} ${tipo}: solicitando cotización ($${stake.toFixed(2)})...`, 'info');

  try {
    const { compra, multiplicador, cotizacion } = await ejecutarOrdenDemo({
      mercadoId, tipo, stake, entrada, sl, tp,
    });
      orderAudit.registrar({
        etapa: 'compra aceptada',
        nivel: 'success',
        modo: 'demo',
        mercadoId,
        nombre,
        tipo,
        origen: opciones.tipoEjecucion === 'canasta_3x' ? 'canasta_3x' : 'automatica',
        contratoId: compra.contract_id,
        stake,
        riesgo: objetivos.riesgo,
        objetivo: objetivos.objetivo,
        detalle: `Orden automática aceptada. Compra $${compra.buy_price}. Saldo posterior $${compra.balance_after}.`,
        datos: { compra, cotizacion, multiplicador },
      });
      executionJournal.abrir({
        id: compra.contract_id,
        mercadoId,
        nombre,
        tipo,
        modo: 'demo',
        origen: 'automatica',
        tipoEjecucion: opciones.tipoEjecucion || null,
        stake,
        entrada,
        multiplicador: cotizacion.multiplicador ?? multiplicador,
        precioCotizado: cotizacion.precioCotizado,
        costosReportados: cotizacion.costosReportados,
        stopLossAmount: objetivos.riesgo,
        takeProfitAmount: objetivos.objetivo,
      });
      const etiquetaTipo = opciones.tipoEjecucion === 'canasta_3x' ? 'Canasta 3x demo' : 'Automático';
      registrarLogAuto(`✅ ${etiquetaTipo}: ${nombre} ${tipo} ejecutado — contrato ${compra.contract_id} | $${stake.toFixed(2)} | x${multiplicador} | saldo: $${compra.balance_after}`, 'success');
      emitirAlerta(`${etiquetaTipo}: ${nombre} ${tipo} ejecutado · contrato ${compra.contract_id}.`, 'success', { notificacion: true });
      actualizarSaldo();
      cargarPortfolio();
      return true;
  } catch (error) {
    orderAudit.registrar({
      etapa: 'error automático',
      nivel: 'error',
      modo: 'demo',
      mercadoId,
      nombre,
      tipo,
      origen: opciones.tipoEjecucion === 'canasta_3x' ? 'canasta_3x' : 'automatica',
      stake,
      detalle: mensajeAmigableError(error),
    });
    emitirAlerta(`${nombre} ${tipo}: automático falló. ${mensajeAmigableError(error)}`, 'error', { notificacion: true });
    registrarLogAuto(`❌ ${nombre} ${tipo}: ${mensajeAmigableError(error)}`, 'error');
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
  if (modoEjecucion === 'real' && activo) {
    alert('El automático está bloqueado en Cuenta real controlada. Usa solo operaciones manuales.');
    const checkbox = document.querySelector(`#card-${id} input[type="checkbox"]`);
    if (checkbox) checkbox.checked = false;
    actualizarPanelAutomatico(id, { activo: false, estadoForzado: null });
    return;
  }
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
  const inversion = riskManager.calcularInversion();
  return modoEjecucion === 'real'
    ? Math.min(inversion, REAL_CONTROLADO_MAX_STAKE)
    : inversion;
}

function etiquetaInversion() {
  return modoEjecucion === 'real'
    ? `Real controlado máx. $${REAL_CONTROLADO_MAX_STAKE}`
    : riskManager.etiqueta();
}

function etiquetaModoOperacion() {
  if (modoEjecucion === 'real') return 'Cuenta real controlada';
  if (modoEjecucion === 'demo') return 'Cuenta demo real';
  return 'Simulación segura';
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
  const historialFiltrado = filtrarHistorial(historial);

  if (historialFiltrado.length === 0) {
    tabla.style.display = 'none';
    vacio.style.display = 'block';
    vacio.textContent = historial.length === 0
      ? 'Aún no se han generado señales BUY/SELL.'
      : 'No hay señales que coincidan con este filtro.';
  } else {
    tabla.style.display = 'table';
    vacio.style.display = 'none';

    tbody.innerHTML = historialFiltrado.slice(0, MAX_HISTORIAL_VISIBLE).map(h => {
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
  const accionTexto = modoEjecucion === 'simulacion'
    ? 'Abrir simulación'
    : modoEjecucion === 'real'
      ? 'Ejecutar real controlado'
      : 'Ejecutar en demo';
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

function seleccionarOpcionMercado(mercadoId) {
  const sel = document.getElementById('select-mercado');
  if (!mercadoId) return sel.value;
  const opcion = Array.from(sel.options).find(item => item.value.startsWith(`${mercadoId}|`));
  if (!opcion) return null;
  sel.value = opcion.value;
  return opcion.value;
}

async function prepararCanastaDemoAutomatica({ silencioso = false } = {}) {
  if (!signalConfig.basketDemoEnabled) {
    if (!silencioso) registrarLogAuto('Canasta 3x demo no está activa.', 'info');
    return [];
  }
  if (modoEjecucion !== 'demo') {
    registrarLogAuto('Canasta 3x: cambia a Cuenta demo real para preparar mercados automáticamente.', 'info');
    return [];
  }

  const candidatos = seleccionarMercadosCanasta(obtenerMercadosRankeados(), signalConfig);
  if (!candidatos.length) {
    registrarLogAuto(
      `Canasta 3x: no hay mercados con puntuación mínima ${signalConfig.basketMinMarketScore}/100 en el top actual.`,
      'info',
    );
    return [];
  }

  const preparados = [];
  for (const mercado of candidatos) {
    const agregado = await agregarMercado(mercado.id, { silencioso: true });
    if (agregado || mercadosActivos[mercado.id]) {
      const checkbox = document.querySelector(`#card-${mercado.id} input[type="checkbox"]`);
      if (checkbox) checkbox.checked = true;
      if (!autoTrader.estaActivo(mercado.id)) toggleAutoMercado(mercado.id, true);
      preparados.push(mercado);
    }
  }

  if (preparados.length || !silencioso) {
    registrarLogAuto(
      `Canasta 3x preparada: ${preparados.map(item => `${item.nombre} (${item.puntuacion}/100)`).join(', ') || 'sin mercados nuevos'}.`,
      preparados.length ? 'success' : 'info',
    );
  }
  return preparados;
}

async function iniciarPruebaDemoAutomatica() {
  const boton = document.querySelector('[onclick="iniciarPruebaDemoAutomatica()"]');
  const textoOriginal = boton?.textContent || 'Iniciar prueba demo automática';
  if (boton) {
    boton.disabled = true;
    boton.textContent = 'Preparando demo...';
  }

  try {
    signalConfig = normalizarSignalConfig({
      ...signalConfig,
      umbralMinimo: Math.max(Number(signalConfig.umbralMinimo) || 70, 85),
      confirmacionesRequeridas: Math.max(Number(signalConfig.confirmacionesRequeridas) || 3, 3),
      filtrarAutoTrading: true,
      basketDemoEnabled: true,
      basketSize: 3,
      basketMinQuality: Math.max(Number(signalConfig.basketMinQuality) || 85, 85),
      basketMinMarketScore: Math.max(Number(signalConfig.basketMinMarketScore) || 60, 60),
      basketMinHistory: 0,
      basketMinWinRate: 60,
    });
    localStorage.setItem(SIGNAL_CONFIG_STORAGE_KEY, JSON.stringify(signalConfig));

    const selectorModo = document.getElementById('execution-mode');
    if (selectorModo) selectorModo.value = 'demo';
    if (modoEjecucion !== 'demo') cambiarModoEjecucion('demo');

    registrarLogAuto('Prueba demo automática: actualizando Top 3 y preparando mercados demo...', 'info');
    await actualizarRankingAutomatico();
    const preparados = await prepararCanastaDemoAutomatica();
    if (preparados.length) {
      emitirAlerta(
        `Prueba demo automática activa: ${preparados.map(item => item.nombre).join(', ')}.`,
        'success',
        { notificacion: true },
      );
    } else {
      emitirAlerta('Prueba demo automática activa, pero aún no hay mercados Top listos para preparar.', 'warning');
    }
  } finally {
    if (boton) {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }
  }
}

async function agregarMercado(mercadoId = null, opciones = {}) {
  const { silencioso = false } = opciones;
  const btn = document.getElementById('btn-add-market');
  const sel = document.getElementById('select-mercado');
  const periodo = parseInt(document.getElementById('select-periodo').value);
  const valorSeleccionado = seleccionarOpcionMercado(mercadoId);
  if (!valorSeleccionado) {
    if (!silencioso) alert(`No encontré el mercado ${mercadoId} en el selector.`);
    return false;
  }
  const [simbolo, nombre, perfil] = valorSeleccionado.split('|');
  const id = simbolo;

  if (mercadosActivos[id]) {
    if (!silencioso) alert(`${nombre} ya está activo.`);
    return true;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Conectando...';
  }

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
      marketHealth[id] = { estado: 'warn', ultimoTick: 0, texto: 'Conectado, esperando ticks' };
      renderProductionHealth();
      suscribirTicks(socket, simbolo);
      const el = document.getElementById(`card-${id}`);
      if (el) el.querySelector('.signal-container').innerHTML =
        '<div class="signal signal-loading">Recopilando precios...</div>';
      if (btn) {
        btn.disabled = false;
        btn.textContent = '+ Agregar';
      }
      },
      onMessage: msg => {
      if (msg.error) {
        marketHealth[id] = { estado: 'error', ultimoTick: Date.now(), texto: mensajeAmigableError(msg.error.message) };
        renderProductionHealth();
        emitirAlerta(`${nombre}: ${mensajeAmigableError(msg.error.message)}`, 'error');
        const el = document.getElementById(`card-${id}`);
        if (el) el.querySelector('.signal-container').innerHTML =
          `<div class="signal signal-sell">Error: ${mensajeAmigableError(msg.error.message)}</div>`;
        return;
      }
      if (msg.tick) {
        const precio = msg.tick.quote;
        marketHealth[id] = { estado: 'ok', ultimoTick: Date.now(), texto: 'Ticks en vivo' };
        renderProductionHealth();
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
        const reglasEstrategia = evaluarReglasEstrategia({
          config: strategyConfig,
          registros: executionJournal.registros,
        });
        const autoActivo = autoTrader.estaActivo(id);
        const observacionRealActiva = modoEjecucion === 'real';
        const disparo = signalTrigger.evaluar({
          tipo: tipoSenal,
          puntuacion: resultadoSenal.calidad.puntuacion,
          activo: (autoActivo && reglasEstrategia.permitido) || observacionRealActiva,
          config: configMercado,
        });
        actualizarPanelAutomatico(id, {
          activo: autoActivo,
          tipo: tipoSenal,
          puntuacion: resultadoSenal.calidad.puntuacion,
          confirmaciones: disparo.confirmaciones,
          cooldownRestante: autoTrader.cooldownRestante(id),
          estadoForzado: observacionRealActiva
            ? 'real_observe'
            : autoActivo && tipoSenal !== 'WAIT' && !reglasEstrategia.permitido
              ? reglasEstrategia.codigo
              : null,
          motivoForzado: observacionRealActiva
            ? 'Si la señal cumple calidad, recibirás aviso para evaluar una operación manual.'
            : reglasEstrategia.motivo,
        });
        if (
          observacionRealActiva
          && tipoSenal !== 'WAIT'
          && disparo.superaUmbral
          && disparo.confirmada
        ) {
          notificarOportunidadReal({
            mercadoId: id,
            nombre,
            tipo: tipoSenal,
            puntuacion: resultadoSenal.calidad.puntuacion,
            entrada: precio,
          });
        }
        if (
          autoActivo
          && !observacionRealActiva
          && tipoSenal !== 'WAIT'
          && disparo.superaUmbral
          && disparo.confirmada
          && !reglasEstrategia.permitido
          && reglasEstrategia.codigo === 'schedule'
        ) {
          notificarOportunidadFueraHorario({
            mercadoId: id,
            nombre,
            tipo: tipoSenal,
            puntuacion: resultadoSenal.calidad.puntuacion,
            entrada: precio,
          });
        }
        if (disparo.ejecutar && !observacionRealActiva) {
          const decisionCanasta = signalConfig.basketDemoEnabled
            ? evaluarCandidatoCanasta({
              config: signalConfig,
              modo: modoEjecucion,
              mercadoId: id,
              calidad: resultadoSenal.calidad.puntuacion,
              mercadoPuntuacion: obtenerPuntuacionMercadoCanasta(id),
              topMarketIds: obtenerTopIdsCanasta(),
              registros: executionJournal.registros,
            })
            : null;

          if (decisionCanasta && !decisionCanasta.permitido) {
            signalTrigger.liberar();
            actualizarPanelAutomatico(id, {
              estadoForzado: null,
              cooldownRestante: autoTrader.cooldownRestante(id),
            });
            registrarLogAuto(`${nombre} ${tipoSenal}: canasta 3x no abrió. ${decisionCanasta.motivo}`, 'info');
            ultimaSenal = tipoSenal;
            return;
          }

          actualizarPanelAutomatico(id, { estadoForzado: 'opening' });
          registrarLogAuto(
            decisionCanasta
              ? `${nombre} ${tipoSenal}: calidad ${resultadoSenal.calidad.puntuacion}/100 aprobada para canasta 3x demo. ${decisionCanasta.motivo}`
              : `${nombre} ${tipoSenal}: calidad confirmada ${resultadoSenal.calidad.puntuacion}/100. Abriendo operación automática.`,
            'success',
          );
          ejecutarOperacionAuto(id, tipoSenal, precio, sl, tp, {
            tipoEjecucion: decisionCanasta ? 'canasta_3x' : null,
          })
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
                `${nombre} ${tipoSenal}: no se pudo abrir automáticamente. ${mensajeAmigableError(error)}`,
                'error',
              );
            });
        } else if (
          tipoSenal !== 'WAIT'
          && autoActivo
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
      marketHealth[id] = { estado: 'error', ultimoTick: Date.now(), texto: 'Error de conexión' };
      renderProductionHealth();
      emitirAlerta(`${nombre}: error de conexión. Refrescando mercado.`, 'error');
      const el = document.getElementById(`card-${id}`);
      if (el) el.querySelector('.signal-container').innerHTML =
        '<div class="signal signal-sell">Error de conexión con Deriv. Refrescando mercado...</div>';
      if (btn) {
        btn.disabled = false;
        btn.textContent = '+ Agregar';
      }
      programarRefrescoMercado(id);
      },
      onClose: () => {
        if (!mercadosActivos[id]) return;
        marketHealth[id] = { estado: 'warn', ultimoTick: marketHealth[id]?.ultimoTick || Date.now(), texto: 'Reconectando' };
        renderProductionHealth();
        programarRefrescoMercado(id);
      },
    });

    mercadosActivos[id] = {
      ws,
      nombre,
      perfil,
      periodo,
      chart,
      precio: null,
      desviacion: null,
      calidad: 0,
    };
    renderRankingMercados();
    return true;
  } catch (error) {
    console.error(error);
    const el = document.getElementById(`card-${id}`);
    if (el) {
      el.querySelector('.signal-container').innerHTML =
        `<div class="signal signal-sell">Error: ${mensajeAmigableError(error)}</div>`;
    } else {
      if (!silencioso) alert(`No se pudo agregar ${nombre}: ${mensajeAmigableError(error)}`);
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = '+ Agregar';
    }
    return false;
  }
}

function programarRefrescoMercado(id) {
  const mercado = mercadosActivos[id];
  if (!mercado || mercado.reconnectTimer) return;
  mercado.reconnectTimer = setTimeout(async () => {
    if (!mercadosActivos[id]) return;
    const selector = document.getElementById('select-mercado');
    const periodoSelector = document.getElementById('select-periodo');
    const opcion = Array.from(selector.options).find(item => item.value.startsWith(`${id}|`));
    if (!opcion) return;
    const periodoActual = periodoSelector.value;
    quitarMercado(id);
    selector.value = opcion.value;
    periodoSelector.value = String(mercado.periodo || periodoActual);
    await agregarMercado();
    periodoSelector.value = periodoActual;
  }, 3000);
}

function quitarMercado(id) {
  if (mercadosActivos[id]) {
    if (mercadosActivos[id].reconnectTimer) clearTimeout(mercadosActivos[id].reconnectTimer);
    mercadosActivos[id].removidoManual = true;
    mercadosActivos[id].ws.close();
    mercadosActivos[id].chart.remove();
    delete mercadosActivos[id];
  }
  autoTrader.eliminar(id);
  delete estadosAutomaticos[id];
  delete marketHealth[id];
  const el = document.getElementById(`card-${id}`);
  if (el) el.remove();
  renderRankingMercados();
  renderProductionHealth();
  if (Object.keys(mercadosActivos).length === 0) {
    document.getElementById('empty').style.display = 'block';
  }
}

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
  abrirBacktesting,
  cerrarBacktesting,
  cerrarBacktestingClick,
  abrirEvaluacionSemanal,
  cerrarEvaluacionSemanal,
  cerrarEvaluacionSemanalClick,
  cerrarOportunidadFueraHorario,
  cerrarOportunidadFueraHorarioClick,
  invertirOportunidadFueraHorario,
  navegarA,
  actualizarMercadosTop,
  cambiarFiltroEjecuciones,
  cambiarFiltroHistorial,
  limpiarRegistroEjecuciones,
  limpiarAuditoriaOrdenes,
  alternarRegistroEjecuciones,
  cerrarEjecuciones,
  cerrarEjecucionesClick,
  abrirPosiciones,
  cerrarPosiciones,
  cerrarPosicionesClick,
  verGraficoPosicion,
  cerrarGraficoPosicion,
  reconciliarConDeriv,
  ejecutarBacktestActual,
  aplicarCalibracionBacktest,
  abrirHistorial,
  cerrarHistorial,
  cerrarHistorialClick,
  limpiarHistorial,
  toggleAutoMercado,
  prepararCanastaDemoAutomatica,
  iniciarPruebaDemoAutomatica,
  cargarPortfolio,
  cerrarPosicion,
  cerrarPosicionSimulada,
  ejecutarOperacion,
  abrirMercadoRecomendado,
  agregarMercado,
  quitarMercado,
});

async function iniciarApp() {
  await cloudSyncReady;
  marketCalibrationStore.cargar();
  globalRiskManager.cargar();
  cargarSignalConfig();
  cargarStrategyConfig();
  cargarHistorialGuardado();
  renderResumenEjecuciones([]);
  executionJournal.cargar();
  orderAudit.cargar();
  simulationEngine.cargar();
  actualizarSaldo();
  setInterval(actualizarSaldo, 30000);
  setInterval(revisarSaludMercados, 15000);
  setInterval(actualizarContadoresPosiciones, 1000);
  renderProductionHealth();
  renderAlertasProduccion();
  renderHistorial();
  cargarPortfolio();
  actualizarRankingAutomatico();
  setInterval(actualizarRankingAutomatico, MARKET_RANKING_REFRESH_MS);
}

iniciarApp().catch(error => {
  console.error('No se pudo iniciar la app:', error);
  registrarLogAuto(`No se pudo iniciar completamente la app: ${mensajeAmigableError(error)}`, 'error');
});
