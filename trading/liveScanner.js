/**
 * Escáner en vivo — monitorea múltiples mercados en segundo plano.
 *
 * Problema que resuelve: antes el usuario tenía que abrir cada mercado
 * manualmente para que empezara el análisis. El escáner abre conexiones
 * ligeras (sin gráfico) a los mercados del ranking, acumula ticks y
 * emite eventos cuando detecta una señal válida con todos los filtros
 * activos: tendencia, rango, soporte/resistencia y patrón de vela.
 *
 * Funciona igual en demo y producción — la diferencia es solo las
 * credenciales del .env, no la lógica.
 */

import {
  calcularMA, calcularRSI, calcularDesviacion, calcularEMA,
  evaluarSenal, detectarSoporteResistencia,
  clasificarTendencia, detectarRango,
} from './strategy.js';
import { puntuarSenal } from './signalScorer.js';
import { PERIODO_EMA, INTERVALO_VELA, VELAS_PARA_SENAL } from '../config.js';

// Cantidad máxima de mercados monitoreados simultáneamente.
// Deriv permite muchas conexiones simultáneas pero abrir demasiadas
// consume recursos del navegador. 6 es un balance razonable.
const MAX_MERCADOS_SCANNER = 6;

// Tiempo mínimo entre señales del mismo mercado para evitar spam (ms).
const COOLDOWN_SENAL_MS = 60_000;

/**
 * Crea un escáner en vivo.
 *
 * @param {object} opciones
 * @param {Function} opciones.obtenerWsUrl  - devuelve la URL del WebSocket
 * @param {Function} opciones.onSenal       - callback cuando hay señal válida
 * @param {Function} opciones.onEstado      - callback con estado de cada mercado
 * @param {number}   opciones.periodo       - periodo del MA/RSI (default 14)
 * @param {number}   opciones.umbralCalidad - puntuación mínima para emitir señal
 */
export function createLiveScanner({
  obtenerWsUrl,
  onSenal = () => {},
  onEstado = () => {},
  periodo = 14,
  umbralCalidad = 65,
} = {}) {
  const mercados = new Map();   // id → estado del mercado
  let activo = false;

  function estadoMercado(id) {
    if (!mercados.has(id)) {
      mercados.set(id, {
        id,
        nombre: id,
        cierres: [],          // cierres de vela para MA/RSI
        cierresHistorico: [], // buffer largo para RSI
        cierresEma: [],       // buffer para EMA de tendencia
        velas: [],            // velas completas para patrones
        velaActual: null,
        tiempoVelaActual: null,
        ws: null,
        ultimaSenal: null,
        ultimaSenalTs: 0,
        velasAcumuladas: 0,
        listo: false,
        tendencia: 'lateral',
        enRango: false,
        tipo: 'WAIT',
        calidad: 0,
      });
    }
    return mercados.get(id);
  }

  function procesarTick(id, precio, epoch) {
    const estado = estadoMercado(id);
    const tiempoVela = Math.floor(epoch / INTERVALO_VELA) * INTERVALO_VELA;

    // Construir velas igual que en app.js
    if (estado.tiempoVelaActual === null || tiempoVela > estado.tiempoVelaActual) {
      if (estado.velaActual !== null) {
        // Vela cerrada — agregar a buffers
        const cierre = estado.velaActual.close;
        estado.cierres.push(cierre);
        estado.cierresHistorico.push(cierre);
        estado.cierresEma.push(cierre);
        estado.velas.push({ ...estado.velaActual });
        estado.velasAcumuladas++;
        if (estado.cierres.length > VELAS_PARA_SENAL) estado.cierres.shift();
        if (estado.cierresHistorico.length > VELAS_PARA_SENAL * 5) estado.cierresHistorico.shift();
        if (estado.cierresEma.length > PERIODO_EMA * 2) estado.cierresEma.shift();
        if (estado.velas.length > 10) estado.velas.shift();
      }
      estado.velaActual = { time: tiempoVela, open: precio, high: precio, low: precio, close: precio };
      estado.tiempoVelaActual = tiempoVela;
    } else {
      estado.velaActual.high = Math.max(estado.velaActual.high, precio);
      estado.velaActual.low = Math.min(estado.velaActual.low, precio);
      estado.velaActual.close = precio;
    }

    if (estado.cierres.length < VELAS_PARA_SENAL) {
      onEstado({ id, listo: false, ticks: estado.velasAcumuladas, periodo: VELAS_PARA_SENAL });
      return;
    }

    const ma = calcularMA(estado.cierres);
    const rsi = calcularRSI(estado.cierresHistorico, periodo);
    const desv = calcularDesviacion(estado.cierres, ma);
    const { soporte, resistencia } = detectarSoporteResistencia(estado.cierresHistorico);
    const tendencia = clasificarTendencia(estado.cierresEma, PERIODO_EMA);
    const { enRango, razon: razonRango } = detectarRango(estado.cierres, rsi, soporte, resistencia);
    const senal = evaluarSenal({ precio, ma, rsi, desviacion: desv, soporte, resistencia, tendencia, enRango });
    const calidad = puntuarSenal({
      tipo: senal.tipo,
      precio,
      ma,
      rsi,
      desviacion: desv,
      precios: estado.cierres,
      velas: estado.velas,
    });

    estado.listo = true;
    estado.tendencia = tendencia;
    estado.enRango = enRango;
    estado.tipo = senal.tipo;
    estado.calidad = calidad.puntuacion;
    estado.precio = precio;
    estado.ma = ma;
    estado.rsi = rsi;

    onEstado({
      id,
      nombre: estado.nombre,
      listo: true,
      ticks: estado.velasAcumuladas,
      periodo: VELAS_PARA_SENAL,
      precio,
      ma,
      rsi,
      tendencia,
      enRango,
      razonRango,
      tipo: senal.tipo,
      calidad: calidad.puntuacion,
      nivel: calidad.nivel,
      soporte,
      resistencia,
    });

    // Emitir señal si supera el umbral y no está en cooldown.
    const ahora = Date.now();
    const enCooldown = ahora - estado.ultimaSenalTs < COOLDOWN_SENAL_MS;
    const senalNueva = senal.tipo !== 'WAIT' && senal.tipo !== estado.ultimaSenal;

    if (senal.tipo !== 'WAIT' && calidad.puntuacion >= umbralCalidad && !enCooldown && senalNueva) {
      estado.ultimaSenal = senal.tipo;
      estado.ultimaSenalTs = ahora;
      onSenal({
        id,
        nombre: estado.nombre,
        tipo: senal.tipo,
        calidad: calidad.puntuacion,
        nivel: calidad.nivel,
        precio,
        sl: senal.sl,
        tp: senal.tp,
        tendencia,
        soporte,
        resistencia,
        patronAlcista: calidad.patronAlcista ?? null,
        patronBajista: calidad.patronBajista ?? null,
        timestamp: new Date().toISOString(),
      });
    }

    // Resetear señal cuando vuelve a WAIT para permitir la próxima detección.
    if (senal.tipo === 'WAIT') {
      estado.ultimaSenal = null;
    }
  }

  async function conectarMercado(id, nombre) {
    if (!activo) return;
    const estado = estadoMercado(id);
    estado.nombre = nombre || id;

    // Cerrar conexión anterior si existe.
    if (estado.ws && estado.ws.readyState < 2) {
      estado.ws.close();
    }

    try {
      const wsUrl = await obtenerWsUrl();
      const ws = new WebSocket(wsUrl);
      estado.ws = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ ticks: id, subscribe: 1 }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.tick) procesarTick(id, msg.tick.quote, msg.tick.epoch);
        } catch (_) {}
      };

      ws.onclose = () => {
        // Reconectar automáticamente si el escáner sigue activo.
        if (activo && mercados.has(id)) {
          setTimeout(() => conectarMercado(id, nombre), 5000);
        }
      };

      ws.onerror = () => {
        if (ws.readyState < 2) ws.close();
      };
    } catch (_) {}
  }

  return {
    /**
     * Inicia el escáner con la lista de mercados dada.
     * @param {Array<{id, nombre}>} lista
     */
    async iniciar(lista) {
      activo = true;
      const seleccion = lista.slice(0, MAX_MERCADOS_SCANNER);
      for (const { id, nombre } of seleccion) {
        await conectarMercado(id, nombre);
        // Pequeña pausa entre conexiones para no saturar a Deriv.
        await new Promise(r => setTimeout(r, 300));
      }
    },

    /** Detiene todas las conexiones del escáner. */
    detener() {
      activo = false;
      for (const estado of mercados.values()) {
        if (estado.ws && estado.ws.readyState < 2) estado.ws.close();
      }
      mercados.clear();
    },

    /** Actualiza la lista de mercados monitoreados. */
    async actualizarLista(lista) {
      const nuevosIds = new Set(lista.slice(0, MAX_MERCADOS_SCANNER).map(m => m.id));

      // Desconectar mercados que ya no están en la lista.
      for (const [id, estado] of mercados.entries()) {
        if (!nuevosIds.has(id)) {
          if (estado.ws && estado.ws.readyState < 2) estado.ws.close();
          mercados.delete(id);
        }
      }

      // Conectar mercados nuevos.
      for (const { id, nombre } of lista.slice(0, MAX_MERCADOS_SCANNER)) {
        if (!mercados.has(id)) {
          await conectarMercado(id, nombre);
          await new Promise(r => setTimeout(r, 300));
        }
      }
    },

    /** Estado actual de todos los mercados monitoreados. */
    obtenerEstados() {
      return Array.from(mercados.values()).map(e => ({ ...e, ws: undefined }));
    },

    get estaActivo() { return activo; },
  };
}
