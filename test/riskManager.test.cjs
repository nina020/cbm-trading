const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL, fileURLToPath } = require('node:url');

async function cargarModulo(rutaInicial) {
  const cache = new Map();

  async function cargar(ruta) {
    const rutaAbsoluta = path.resolve(ruta);
    if (cache.has(rutaAbsoluta)) return cache.get(rutaAbsoluta);

    const codigo = await fs.readFile(rutaAbsoluta, 'utf8');
    const modulo = new vm.SourceTextModule(codigo, {
      identifier: pathToFileURL(rutaAbsoluta).href,
    });
    cache.set(rutaAbsoluta, modulo);

    await modulo.link((specifier, referencia) => {
      const rutaReferencia = fileURLToPath(referencia.identifier);
      return cargar(path.resolve(path.dirname(rutaReferencia), specifier));
    });
    return modulo;
  }

  const modulo = await cargar(rutaInicial);
  await modulo.evaluate();
  return modulo.namespace;
}

const riskManager = cargarModulo(path.join(__dirname, '../trading/riskManager.js'));
const strategyRules = cargarModulo(path.join(__dirname, '../trading/strategyRules.js'));
const basketTrader = cargarModulo(path.join(__dirname, '../trading/basketTrader.js'));
const orderAudit = cargarModulo(path.join(__dirname, '../trading/orderAudit.js'));

const operacionBuy = {
  tipo: 'BUY',
  entrada: 100,
  sl: 99,
  tp: 101.5,
};

test('los objetivos monetarios son proporcionales a la inversión', async () => {
  const { calcularObjetivosMonetarios } = await riskManager;
  const montos = [5, 20, 100];
  const objetivos = montos.map(calcularObjetivosMonetarios);

  assert.deepEqual(objetivos.map(objetivo => ({ ...objetivo })), [
    { inversion: 5, riesgo: 1.25, objetivo: 2.5 },
    { inversion: 20, riesgo: 5, objetivo: 10 },
    { inversion: 100, riesgo: 25, objetivo: 50 },
  ]);
  assert.equal(objetivos[1].objetivo / objetivos[0].objetivo, 4);
});

test('la señal coloca SL y TP a las desviaciones configuradas conservando el ratio', async () => {
  const { evaluarSenal } = await cargarModulo(
    path.join(__dirname, '../trading/strategy.js'),
  );
  const config = await cargarModulo(path.join(__dirname, '../config.js'));
  const desviacion = 0.4;
  const senal = evaluarSenal({ precio: 100, ma: 99, rsi: 55, desviacion });

  assert.equal(senal.tipo, 'BUY');
  assert.equal(senal.sl, 100 - desviacion * config.SL_DESVIACIONES);
  assert.equal(senal.tp, 100 + desviacion * config.TP_DESVIACIONES);
  assert.ok(
    Math.abs((senal.tp - 100) / (100 - senal.sl) - config.RATIO_RECOMPENSA) < 1e-9,
  );

  const venta = evaluarSenal({ precio: 100, ma: 101, rsi: 45, desviacion });
  assert.equal(venta.tipo, 'SELL');
  assert.equal(venta.sl, 100 + desviacion * config.SL_DESVIACIONES);
  assert.equal(venta.tp, 100 - desviacion * config.TP_DESVIACIONES);
});

test('la orden demo usa los mismos objetivos monetarios que la simulación', async () => {
  const { crearPayload } = await cargarModulo(
    path.join(__dirname, '../trading/orderService.js'),
  );
  const payload = crearPayload({
    mercadoId: 'TEST',
    contractType: 'MULTUP',
    stake: 20,
    entrada: 100,
    sl: 99,
    tp: 101.5,
    multiplicador: 100,
  });

  assert.equal(payload.limit_order.stop_loss, 5);
  assert.equal(payload.limit_order.take_profit, 10);
});

test('la orden demo redondea montos a 2 decimales para Deriv', async () => {
  const { crearPayload } = await cargarModulo(
    path.join(__dirname, '../trading/orderService.js'),
  );
  const payload = crearPayload({
    mercadoId: 'TEST',
    contractType: 'MULTUP',
    stake: 119.968,
    entrada: 100,
    sl: 99,
    tp: 101.5,
    multiplicador: 100,
    limitesMinimos: {
      stop_loss: 0.12345,
      take_profit: 0.12345,
    },
  });

  assert.equal(payload.amount, 119.97);
  assert.equal(payload.limit_order.stop_loss, 29.99);
  assert.equal(payload.limit_order.take_profit, 59.99);
});

test('la orden usa la moneda de la cuenta y USD solo como respaldo', async () => {
  const { crearPayload } = await cargarModulo(
    path.join(__dirname, '../trading/orderService.js'),
  );
  const base = {
    mercadoId: 'TEST',
    contractType: 'MULTUP',
    stake: 20,
    entrada: 100,
    sl: 99,
    tp: 101.5,
    multiplicador: 100,
  };

  assert.equal(crearPayload({ ...base, currency: 'EUR' }).currency, 'EUR');
  assert.equal(crearPayload(base).currency, 'USD');
});

test('el multiplicador se ajusta para que el stop monetario coincida con el stop de la señal', async () => {
  const { calcularMultiplicadorObjetivo } = await cargarModulo(
    path.join(__dirname, '../trading/orderService.js'),
  );

  // Riesgo 25% del stake con stop a 1 punto desde entrada 100: 0.25 * 100 / 1 = x25.
  assert.equal(calcularMultiplicadorObjetivo({ entrada: 100, sl: 99 }), 25);
  // Stop más lejano (más volatilidad) exige multiplicador menor.
  assert.equal(calcularMultiplicadorObjetivo({ entrada: 100, sl: 95 }), 5);
  // Stop más cercano (menos volatilidad) exige multiplicador mayor.
  assert.equal(calcularMultiplicadorObjetivo({ entrada: 100, sl: 99.9 }), 250);
  // Sin datos válidos se usa el multiplicador por defecto.
  assert.equal(calcularMultiplicadorObjetivo({ entrada: 100, sl: 100 }), 100);
  assert.equal(calcularMultiplicadorObjetivo({ entrada: null, sl: 99 }), 100);
});

test('ante multiplicador fuera de rango se elige el permitido más cercano al objetivo', async () => {
  const { elegirMultiplicadorPermitido } = await cargarModulo(
    path.join(__dirname, '../trading/orderService.js'),
  );

  assert.equal(elegirMultiplicadorPermitido([50, 100, 150, 200], 120), 100);
  assert.equal(elegirMultiplicadorPermitido([50, 100, 150, 200], 130), 150);
  assert.equal(elegirMultiplicadorPermitido([100, 200, 300], 25), 100);
  assert.equal(elegirMultiplicadorPermitido([100, 200, 300], 5000), 300);
  assert.equal(elegirMultiplicadorPermitido([], 100), null);
});

test('la cotización conserva multiplicador y solo suma costos explícitos', async () => {
  const { normalizarCotizacion, extraerCostosReportados } = await cargarModulo(
    path.join(__dirname, '../trading/orderService.js'),
  );
  const sinCostos = normalizarCotizacion({
    id: 'proposal-1',
    ask_price: 20,
    payout: 0,
    spot: 100,
  }, 100);
  const conCostos = normalizarCotizacion({
    id: 'proposal-2',
    ask_price: 20,
    spot: 100,
    commission: 0.25,
    charges: [{ amount: 0.1 }],
  }, 50);

  assert.equal(sinCostos.multiplicador, 100);
  assert.equal(sinCostos.costosReportados, null);
  assert.equal(conCostos.multiplicador, 50);
  assert.equal(conCostos.costosReportados, 0.35);
  assert.equal(extraerCostosReportados({ fee: -0.2 }), 0.2);
});

test('la orden ignora propuestas duplicadas y confirma una sola vez', async () => {
  const fetchOriginal = globalThis.fetch;
  const webSocketOriginal = globalThis.WebSocket;
  let confirmaciones = 0;
  let compras = 0;

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ url: 'wss://deriv.test' }),
  });
  globalThis.WebSocket = class FakeWebSocket {
    constructor() {
      setTimeout(() => this.onopen?.({}), 0);
    }

    send(mensaje) {
      const data = JSON.parse(mensaje);
      if (data.proposal) {
        setTimeout(() => {
          this.onmessage?.({
            data: JSON.stringify({
              msg_type: 'proposal',
              proposal: { id: 'proposal-1', ask_price: 1, spot: 100, multiplier: 100 },
            }),
          });
          this.onmessage?.({
            data: JSON.stringify({
              msg_type: 'proposal',
              proposal: { id: 'proposal-2', ask_price: 1, spot: 100, multiplier: 100 },
            }),
          });
        }, 0);
      }
      if (data.buy) {
        compras++;
        setTimeout(() => {
          this.onmessage?.({
            data: JSON.stringify({
              msg_type: 'buy',
              buy: { contract_id: 123, buy_price: 1, balance_after: 99 },
            }),
          });
        }, 0);
      }
    }

    close() {}
  };

  try {
    const { ejecutarOrdenDemo } = await cargarModulo(
      path.join(__dirname, '../trading/orderService.js'),
    );
    const resultado = await ejecutarOrdenDemo({
      mercadoId: 'R_10',
      tipo: 'BUY',
      stake: 1,
      entrada: 100,
      sl: 99,
      tp: 101,
      accountMode: 'real',
    }, {
      confirmarCotizacion: () => {
        confirmaciones++;
        return true;
      },
    });

    assert.equal(confirmaciones, 1);
    assert.equal(compras, 1);
    assert.equal(resultado.compra.contract_id, 123);
  } finally {
    globalThis.fetch = fetchOriginal;
    globalThis.WebSocket = webSocketOriginal;
  }
});

test('el registro separa P&L bruto, costos y neto sin inventar comisiones', async () => {
  const { createExecutionJournal } = await cargarModulo(
    path.join(__dirname, '../trading/executionJournal.js'),
  );
  const datos = new Map();
  const journal = createExecutionJournal({
    storageKey: 'ejecuciones',
    onChange: () => {},
    storage: {
      getItem: key => datos.get(key) || null,
      setItem: (key, value) => datos.set(key, value),
      removeItem: key => datos.delete(key),
    },
  });

  journal.abrir({
    id: 1,
    mercadoId: 'TEST',
    nombre: 'Prueba',
    tipo: 'BUY',
    modo: 'demo',
    origen: 'manual',
    stake: 20,
    entrada: 100,
    multiplicador: 100,
  });
  journal.cerrar(1, { pnlNeto: 5 });

  assert.equal(journal.registros[0].costos, null);
  assert.equal(journal.registros[0].pnlBruto, null);
  assert.equal(journal.registros[0].pnlNeto, 5);

  journal.abrir({
    id: 2,
    mercadoId: 'TEST',
    nombre: 'Prueba',
    tipo: 'SELL',
    modo: 'demo',
    origen: 'manual',
    stake: 20,
    entrada: 100,
  });
  journal.cerrar(2, { pnlNeto: 5, costos: 0.5 });

  assert.equal(journal.registros[0].costos, 0.5);
  assert.equal(journal.registros[0].pnlBruto, 5.5);
  assert.equal(journal.registros[0].pnl, 5);
});

test('la auditoría de órdenes guarda eventos y respeta el límite configurado', async () => {
  const { createOrderAudit } = await orderAudit;
  const memoria = new Map();
  const storage = {
    getItem: key => memoria.get(key) || null,
    setItem: (key, value) => memoria.set(key, value),
    removeItem: key => memoria.delete(key),
  };
  const cambios = [];
  const audit = createOrderAudit({
    storageKey: 'audit',
    storage,
    limit: 2,
    onChange: eventos => cambios.push(eventos.length),
  });

  audit.cargar();
  audit.registrar({ etapa: 'intento', mercadoId: 'R_10', modo: 'demo', detalle: 'uno' });
  audit.registrar({ etapa: 'cotización', mercadoId: 'R_10', modo: 'demo', detalle: 'dos' });
  audit.registrar({ etapa: 'compra', mercadoId: 'R_10', modo: 'demo', detalle: 'tres' });

  assert.equal(audit.eventos.length, 3);
  assert.equal(JSON.parse(memoria.get('audit')).length, 2);
  assert.equal(audit.eventos[0].etapa, 'compra');
  assert.deepEqual(cambios, [0, 1, 2, 3]);

  audit.limpiar();
  assert.equal(audit.eventos.length, 0);
  assert.equal(memoria.has('audit'), false);
});

test('la configuración de señales aplica límites seguros', async () => {
  const { normalizarSignalConfig } = await cargarModulo(
    path.join(__dirname, '../trading/signalScorer.js'),
  );

  assert.deepEqual({ ...normalizarSignalConfig({
    umbralMinimo: 120,
    confirmacionesRequeridas: 0,
    filtrarAutoTrading: false,
  }) }, {
    umbralMinimo: 95,
    confirmacionesRequeridas: 2,
    filtrarAutoTrading: false,
    basketDemoEnabled: false,
    basketSize: 3,
    basketMinQuality: 85,
    basketMinMarketScore: 60,
    basketMinHistory: 0,
    basketMinWinRate: 60,
  });
});

test('el scorer puntúa BUY y SELL fuertes de forma simétrica', async () => {
  const { puntuarSenal } = await cargarModulo(
    path.join(__dirname, '../trading/signalScorer.js'),
  );
  const buy = puntuarSenal({
    tipo: 'BUY',
    precio: 104,
    ma: 100,
    rsi: 60,
    desviacion: 2,
    precios: [99, 100, 101, 102, 103, 104],
  });
  const sell = puntuarSenal({
    tipo: 'SELL',
    precio: 96,
    ma: 100,
    rsi: 40,
    desviacion: 2,
    precios: [101, 100, 99, 98, 97, 96],
  });

  assert.equal(buy.puntuacion, sell.puntuacion);
  assert.ok(buy.puntuacion >= 80);
  assert.equal(buy.nivel, 'fuerte');
  assert.equal(sell.nivel, 'fuerte');
});

test('una señal débil queda debajo del umbral automático recomendado', async () => {
  const { puntuarSenal } = await cargarModulo(
    path.join(__dirname, '../trading/signalScorer.js'),
  );
  const resultado = puntuarSenal({
    tipo: 'BUY',
    precio: 100.1,
    ma: 100,
    rsi: 69,
    desviacion: 2,
    precios: [100, 100.2, 100.1, 100.3, 100.1],
  });

  assert.ok(resultado.puntuacion < 70);
});

test('el auto trading abre cuando una señal existente alcanza la calidad requerida', async () => {
  const { createSignalTrigger } = await cargarModulo(
    path.join(__dirname, '../trading/signalScorer.js'),
  );
  const trigger = createSignalTrigger();
  const config = {
    umbralMinimo: 70,
    confirmacionesRequeridas: 3,
    filtrarAutoTrading: true,
  };

  assert.equal(trigger.evaluar({
    tipo: 'BUY', puntuacion: 55, activo: true, config,
  }).ejecutar, false);
  assert.equal(trigger.evaluar({
    tipo: 'BUY', puntuacion: 65, activo: true, config,
  }).ejecutar, false);
  assert.equal(trigger.evaluar({
    tipo: 'BUY', puntuacion: 72, activo: true, config,
  }).ejecutar, true);
  assert.equal(trigger.evaluar({
    tipo: 'BUY', puntuacion: 85, activo: true, config,
  }).ejecutar, false);
});

test('activar auto trading durante una señal abre al alcanzar el umbral sin duplicar', async () => {
  const { createSignalTrigger } = await cargarModulo(
    path.join(__dirname, '../trading/signalScorer.js'),
  );
  const trigger = createSignalTrigger();
  const config = {
    umbralMinimo: 70,
    confirmacionesRequeridas: 2,
    filtrarAutoTrading: true,
  };

  trigger.evaluar({ tipo: 'SELL', puntuacion: 75, activo: false, config });
  assert.equal(trigger.evaluar({
    tipo: 'SELL', puntuacion: 78, activo: true, config,
  }).ejecutar, true);
  assert.equal(trigger.evaluar({
    tipo: 'SELL', puntuacion: 82, activo: true, config,
  }).ejecutar, false);

  trigger.evaluar({ tipo: 'WAIT', puntuacion: 0, activo: true, config });
  assert.equal(trigger.evaluar({
    tipo: 'SELL', puntuacion: 80, activo: true, config,
  }).ejecutar, false);
  assert.equal(trigger.evaluar({
    tipo: 'SELL', puntuacion: 80, activo: true, config,
  }).ejecutar, true);
});

test('una ejecución bloqueada por cooldown puede reintentarse en la misma señal', async () => {
  const { createSignalTrigger } = await cargarModulo(
    path.join(__dirname, '../trading/signalScorer.js'),
  );
  const trigger = createSignalTrigger();
  const config = {
    umbralMinimo: 70,
    confirmacionesRequeridas: 1,
    filtrarAutoTrading: true,
  };

  assert.equal(trigger.evaluar({
    tipo: 'BUY', puntuacion: 80, activo: true, config,
  }).ejecutar, true);
  trigger.liberar();
  assert.equal(trigger.evaluar({
    tipo: 'BUY', puntuacion: 82, activo: true, config,
  }).ejecutar, true);
});

test('la canasta 3x solo acepta candidatos demo del top con calidad suficiente', async () => {
  const { evaluarCandidatoCanasta, seleccionarMercadosCanasta } = await basketTrader;
  const config = {
    basketDemoEnabled: true,
    basketSize: 3,
    basketMinQuality: 85,
    basketMinMarketScore: 60,
    basketMinHistory: 0,
    basketMinWinRate: 60,
  };

  assert.deepEqual(seleccionarMercadosCanasta([
    { id: 'BAJO', listo: true, nivel: 'considerar', puntuacion: 59 },
    { id: 'R_25', listo: true, nivel: 'considerar', puntuacion: 72 },
    { id: 'R_10', listo: true, nivel: 'recomendable', puntuacion: 88 },
    { id: 'NO_LISTO', listo: false, nivel: 'recomendable', puntuacion: 99 },
  ], config).map(item => item.id), ['R_10', 'R_25']);

  assert.equal(evaluarCandidatoCanasta({
    config,
    modo: 'real',
    mercadoId: 'R_10',
    calidad: 90,
    topMarketIds: ['R_10', 'R_25', 'stpRNG'],
    registros: [],
  }).codigo, 'mode');

  assert.equal(evaluarCandidatoCanasta({
    config,
    modo: 'demo',
    mercadoId: 'R_50',
    calidad: 90,
    topMarketIds: ['R_10', 'R_25', 'stpRNG'],
    registros: [],
  }).codigo, 'not_top');

  assert.equal(evaluarCandidatoCanasta({
    config,
    modo: 'demo',
    mercadoId: 'R_10',
    calidad: 80,
    mercadoPuntuacion: 88,
    topMarketIds: ['R_10', 'R_25', 'stpRNG'],
    registros: [],
  }).codigo, 'quality');

  assert.equal(evaluarCandidatoCanasta({
    config,
    modo: 'demo',
    mercadoId: 'R_10',
    calidad: 90,
    mercadoPuntuacion: 55,
    topMarketIds: ['R_10', 'R_25', 'stpRNG'],
    registros: [],
  }).codigo, 'market_score');

  assert.equal(evaluarCandidatoCanasta({
    config,
    modo: 'demo',
    mercadoId: 'R_10',
    calidad: 90,
    mercadoPuntuacion: 88,
    topMarketIds: ['R_10', 'R_25', 'stpRNG'],
    registros: [],
  }).permitido, true);
});

test('la canasta 3x evita repetir mercado y respeta historial mínimo', async () => {
  const { evaluarCandidatoCanasta } = await basketTrader;
  const config = {
    basketDemoEnabled: true,
    basketSize: 3,
    basketMinQuality: 85,
    basketMinMarketScore: 60,
    basketMinHistory: 2,
    basketMinWinRate: 60,
  };
  const registros = [
    { modo: 'demo', mercadoId: 'R_10', estado: 'pendiente', tipoEjecucion: 'canasta_3x' },
    { modo: 'demo', mercadoId: 'R_25', estado: 'ganada' },
  ];

  assert.equal(evaluarCandidatoCanasta({
    config,
    modo: 'demo',
    mercadoId: 'R_10',
    calidad: 90,
    topMarketIds: ['R_10', 'R_25', 'stpRNG'],
    registros,
  }).codigo, 'duplicate_market');

  assert.equal(evaluarCandidatoCanasta({
    config,
    modo: 'demo',
    mercadoId: 'R_25',
    calidad: 90,
    topMarketIds: ['R_10', 'R_25', 'stpRNG'],
    registros,
  }).codigo, 'sample');
});

test('el panel automático explica calidad, confirmaciones y cooldown', async () => {
  const { determinarEstadoAutomatico } = await cargarModulo(
    path.join(__dirname, '../components/autoStatus.js'),
  );
  const config = {
    umbralMinimo: 70,
    confirmacionesRequeridas: 3,
    filtrarAutoTrading: true,
  };

  assert.equal(determinarEstadoAutomatico({
    activo: false, config,
  }).codigo, 'off');
  assert.equal(determinarEstadoAutomatico({
    activo: true, tipo: 'WAIT', config,
  }).codigo, 'waiting');
  assert.equal(determinarEstadoAutomatico({
    activo: true, tipo: 'BUY', puntuacion: 65, confirmaciones: 3, config,
  }).codigo, 'quality');
  assert.equal(determinarEstadoAutomatico({
    activo: true, tipo: 'SELL', puntuacion: 80, confirmaciones: 2, config,
  }).codigo, 'confirming');
  assert.equal(determinarEstadoAutomatico({
    activo: true, tipo: 'BUY', puntuacion: 80, confirmaciones: 3,
    cooldownRestante: 12, config,
  }).codigo, 'cooldown');
  assert.equal(determinarEstadoAutomatico({
    activo: true, tipo: 'BUY', puntuacion: 80, confirmaciones: 3, config,
  }).codigo, 'ready');
});

test('autoTrader informa el cooldown restante por mercado', async () => {
  const { createAutoTrader } = await cargarModulo(
    path.join(__dirname, '../trading/autoTrader.js'),
  );
  let ahora = 100000;
  const trader = createAutoTrader({
    getCooldown: () => 60,
    getNombre: id => id,
    onLog: () => {},
    execute: async () => {},
    getNow: () => ahora,
  });

  assert.equal(trader.cooldownRestante('TEST'), 0);
  assert.equal(await trader.procesar('TEST', 'BUY', 100, 99, 101), true);
  assert.equal(trader.cooldownRestante('TEST'), 60);
  ahora += 30500;
  assert.equal(trader.cooldownRestante('TEST'), 30);
  ahora += 30000;
  assert.equal(trader.cooldownRestante('TEST'), 0);
});

test('las posiciones priorizan límites monetarios reportados por Deriv', async () => {
  const { resolverLimitesMonetarios } = await cargarModulo(
    path.join(__dirname, '../components/positionCards.js'),
  );
  const limites = resolverLimitesMonetarios({
    contrato: {
      limit_order: {
        stop_loss: { order_amount: 12 },
        take_profit: { order_amount: 24 },
      },
    },
    registro: { stopLossAmount: 10, takeProfitAmount: 20 },
    objetivos: { riesgo: 9, objetivo: 13.5 },
  });

  assert.deepEqual({ ...limites }, {
    stopLossAmount: 12,
    takeProfitAmount: 24,
  });
});

test('las posiciones interpretan timestamps de cierre y apertura de Deriv', async () => {
  const { obtenerTimestampContrato } = await cargarModulo(
    path.join(__dirname, '../components/positionCards.js'),
  );

  assert.equal(obtenerTimestampContrato({ purchase_time: 1710000000 }, ['purchase_time']), 1710000000);
  assert.equal(obtenerTimestampContrato({ date_expiry: 1710000000000 }, ['date_expiry']), 1710000000);
  assert.equal(obtenerTimestampContrato({ otro: 1710000000 }, ['purchase_time']), null);
});

test('las posiciones usan registro y cálculo como respaldo para SL/TP', async () => {
  const { resolverLimitesMonetarios } = await cargarModulo(
    path.join(__dirname, '../components/positionCards.js'),
  );
  const desdeRegistro = resolverLimitesMonetarios({
    contrato: {},
    registro: { stopLossAmount: 18, takeProfitAmount: 27 },
    objetivos: { riesgo: 9, objetivo: 13.5 },
  });
  const desdeStake = resolverLimitesMonetarios({
    contrato: {},
    registro: null,
    objetivos: { riesgo: 4.5, objetivo: 6.75 },
  });

  assert.deepEqual({ ...desdeRegistro }, {
    stopLossAmount: 18,
    takeProfitAmount: 27,
  });
  assert.deepEqual({ ...desdeStake }, {
    stopLossAmount: 4.5,
    takeProfitAmount: 6.75,
  });
});

test('el registro conserva los límites monetarios de la operación', async () => {
  const { createExecutionJournal } = await cargarModulo(
    path.join(__dirname, '../trading/executionJournal.js'),
  );
  const journal = createExecutionJournal({
    storageKey: 'limites',
    onChange: () => {},
    storage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
  });
  journal.abrir({
    id: 123,
    mercadoId: 'TEST',
    nombre: 'Prueba',
    tipo: 'BUY',
    modo: 'demo',
    origen: 'manual',
    stake: 20,
    entrada: 100,
    stopLossAmount: 18,
    takeProfitAmount: 27,
  });

  assert.equal(journal.obtener(123).stopLossAmount, 18);
  assert.equal(journal.obtener('123').takeProfitAmount, 27);
});

test('el servicio WebSocket puede consultar el estado de un contrato Deriv', async () => {
  const { solicitarContratoEstado } = await cargarModulo(
    path.join(__dirname, '../services/websocketService.js'),
  );
  let enviado = null;
  solicitarContratoEstado({
    send: mensaje => { enviado = JSON.parse(mensaje); },
  }, 12345);

  assert.deepEqual(enviado, {
    proposal_open_contract: 1,
    contract_id: 12345,
  });
});

test('el ranking prioriza un mercado estable con mejor señal e historial', async () => {
  const { ordenarMercadosParaInicio } = await cargarModulo(
    path.join(__dirname, '../trading/marketRanking.js'),
  );
  const registros = Array.from({ length: 10 }, (_, index) => ({
    mercadoId: 'ESTABLE',
    modo: 'demo',
    estado: index < 7 ? 'ganada' : 'perdida',
  }));
  const ranking = ordenarMercadosParaInicio([
    {
      id: 'VOLATIL',
      nombre: 'Volátil',
      perfil: 'alta',
      precio: 100,
      desviacion: 1.2,
      calidad: 55,
      registros: [],
    },
    {
      id: 'ESTABLE',
      nombre: 'Estable',
      perfil: 'estable',
      precio: 100,
      desviacion: 0.1,
      calidad: 80,
      signalConfig: { umbralMinimo: 75 },
      registros,
    },
  ]);

  assert.equal(ranking[0].id, 'ESTABLE');
  assert.equal(ranking[0].nivel, 'recomendable');
  assert.equal(ranking[0].historial.winRate, 70);
  assert.ok(ranking[0].puntuacion > ranking[1].puntuacion);
});

test('el ranking reduce el peso de historiales pequeños y espera datos de precio', async () => {
  const { evaluarMercadoParaInicio } = await cargarModulo(
    path.join(__dirname, '../trading/marketRanking.js'),
  );
  const base = {
    id: 'TEST',
    nombre: 'Prueba',
    perfil: 'media',
    precio: 100,
    desviacion: 0.2,
    calidad: 70,
  };
  const unaGanada = evaluarMercadoParaInicio({
    ...base,
    registros: [{ mercadoId: 'TEST', modo: 'demo', estado: 'ganada' }],
  });
  const veinteGanadas = evaluarMercadoParaInicio({
    ...base,
    registros: Array.from({ length: 20 }, () => ({
      mercadoId: 'TEST',
      modo: 'demo',
      estado: 'ganada',
    })),
  });
  const sinPrecio = evaluarMercadoParaInicio({
    ...base,
    precio: null,
    desviacion: null,
  });

  assert.ok(veinteGanadas.puntuacion > unaGanada.puntuacion);
  assert.equal(sinPrecio.listo, false);
  assert.equal(sinPrecio.nivel, 'recopilando');
});

test('el ranking solo cuenta operaciones enviadas a Deriv, no simulaciones', async () => {
  const { evaluarMercadoParaInicio } = await cargarModulo(
    path.join(__dirname, '../trading/marketRanking.js'),
  );
  const resultado = evaluarMercadoParaInicio({
    id: 'TEST',
    nombre: 'Prueba',
    perfil: 'media',
    precio: 100,
    desviacion: 0.2,
    calidad: 70,
    registros: [
      { mercadoId: 'TEST', modo: 'demo', estado: 'ganada' },
      { mercadoId: 'TEST', modo: 'real', estado: 'perdida' },
      { mercadoId: 'TEST', modo: 'simulacion', estado: 'ganada' },
      { mercadoId: 'TEST', modo: 'simulacion', estado: 'ganada' },
      { mercadoId: 'TEST', estado: 'ganada' },
    ],
  });

  assert.equal(resultado.historial.total, 2);
  assert.equal(resultado.historial.winRate, 50);
});

test('el ranking ajusta la recomendación por umbral y estado operativo', async () => {
  const { evaluarMercadoParaInicio } = await cargarModulo(
    path.join(__dirname, '../trading/marketRanking.js'),
  );
  const base = {
    id: 'TEST',
    nombre: 'Prueba',
    perfil: 'estable',
    precio: 100,
    desviacion: 0.05,
    calidad: 82,
    signalConfig: { umbralMinimo: 80 },
    registros: [],
  };
  const disponible = evaluarMercadoParaInicio({
    ...base,
    estrategia: { permitido: true, codigo: 'ready', motivo: 'Disponible' },
  });
  const fueraHorario = evaluarMercadoParaInicio({
    ...base,
    estrategia: { permitido: false, codigo: 'schedule', motivo: 'Fuera de horario' },
  });
  const debajoUmbral = evaluarMercadoParaInicio({
    ...base,
    calidad: 65,
    estrategia: { permitido: true, codigo: 'ready', motivo: 'Disponible' },
  });

  assert.ok(disponible.puntuacion > fueraHorario.puntuacion);
  assert.equal(fueraHorario.nivel, 'considerar');
  assert.ok(disponible.puntuacion > debajoUmbral.puntuacion);
});

test('el escáner calcula estabilidad y calidad desde ticks históricos', async () => {
  const { analizarMercadoHistorico } = await cargarModulo(
    path.join(__dirname, '../trading/marketScanner.js'),
  );
  const mercado = { id: 'ESTABLE', nombre: 'Estable', perfil: 'estable' };
  const ticks = Array.from({ length: 20 }, (_, index) => ({
    precio: 100 + index * 0.02,
  }));
  const resultado = analizarMercadoHistorico({ mercado, ticks, periodo: 14 });

  assert.equal(resultado.id, 'ESTABLE');
  assert.ok(resultado.precio > 100);
  assert.ok(resultado.desviacion > 0);
  assert.ok(resultado.calidad >= 0 && resultado.calidad <= 100);
});

test('el escáner continúa cuando un mercado no puede consultarse', async () => {
  const { escanearMercadosEstables } = await cargarModulo(
    path.join(__dirname, '../trading/marketScanner.js'),
  );
  const mercados = [
    { id: 'OK', nombre: 'Disponible', perfil: 'estable' },
    { id: 'ERROR', nombre: 'No disponible', perfil: 'estable' },
  ];
  const resultados = await escanearMercadosEstables({
    mercados,
    periodo: 14,
    concurrencia: 2,
    obtenerTicks: async id => {
      if (id === 'ERROR') throw new Error('Sin datos');
      return Array.from({ length: 20 }, (_, index) => ({ precio: 100 + index * 0.01 }));
    },
  });

  assert.equal(resultados.length, 1);
  assert.equal(resultados[0].id, 'OK');
});

test('el riesgo global bloquea pérdida diaria y máximo de posiciones', async () => {
  const { createGlobalRiskManager } = await cargarModulo(
    path.join(__dirname, '../trading/globalRiskManager.js'),
  );
  const ahora = new Date('2026-06-15T12:00:00Z').getTime();
  const manager = createGlobalRiskManager({
    storageKey: 'riesgo',
    getNow: () => ahora,
    storage: {
      getItem: () => null,
      setItem: () => {},
    },
  });
  manager.cargar();
  manager.configurar({
    perdidaMaximaDiaria: 20,
    maxPosicionesAbiertas: 2,
    maxPerdidasConsecutivas: 3,
    pausaMinutos: 30,
  });

  const maxPosiciones = manager.evaluar({
    registros: [
      { estado: 'pendiente' },
      { estado: 'pendiente' },
    ],
    riesgoOperacion: 1,
  });
  const perdidaDiaria = manager.evaluar({
    registros: [{
      estado: 'perdida',
      pnlNeto: -15,
      cerradaEn: '2026-06-15T10:00:00Z',
    }],
    riesgoOperacion: 6,
  });
  const mercadoDuplicado = manager.evaluar({
    registros: [
      { estado: 'pendiente', mercadoId: 'R_10' },
    ],
    mercadoId: 'R_10',
    riesgoOperacion: 1,
  });
  const mercadoDistinto = manager.evaluar({
    registros: [
      { estado: 'pendiente', mercadoId: 'R_10' },
    ],
    mercadoId: 'R_25',
    riesgoOperacion: 1,
  });
  const mercadoGenerico = manager.evaluar({
    registros: [
      { estado: 'pendiente', mercadoId: 'Mercado' },
    ],
    mercadoId: 'stpRNG5',
    riesgoOperacion: 1,
  });

  assert.equal(maxPosiciones.codigo, 'max_posiciones');
  assert.equal(perdidaDiaria.codigo, 'perdida_diaria');
  assert.equal(mercadoDuplicado.codigo, 'mercado_duplicado');
  assert.equal(mercadoDistinto.codigo, 'ok');
  assert.equal(mercadoGenerico.codigo, 'ok');
});

test('el riesgo global por defecto usa perdida diaria baja y sin limite de posiciones', async () => {
  const { createGlobalRiskManager } = await cargarModulo(
    path.join(__dirname, '../trading/globalRiskManager.js'),
  );
  const manager = createGlobalRiskManager({
    storageKey: 'riesgo-default',
    storage: {
      getItem: () => null,
      setItem: () => {},
    },
  });
  manager.cargar();

  const estado = manager.estado([]);
  const muchasPosiciones = manager.evaluar({
    registros: Array.from({ length: 10 }, (_, index) => ({ id: index, estado: 'pendiente', mercadoId: `R_${index}` })),
    riesgoOperacion: 0.25,
    mercadoId: 'stpRNG5',
  });
  const perdidaDiaria = manager.evaluar({
    registros: [{
      estado: 'perdida',
      pnlNeto: -1.9,
      cerradaEn: new Date().toISOString(),
    }],
    riesgoOperacion: 0.25,
  });

  assert.equal(estado.config.perdidaMaximaDiaria, 2);
  assert.equal(estado.config.maxPosicionesAbiertas, 0);
  assert.equal(muchasPosiciones.codigo, 'ok');
  assert.equal(perdidaDiaria.codigo, 'perdida_diaria');
});

test('el riesgo global pausa después de pérdidas consecutivas y puede reanudarse', async () => {
  const { createGlobalRiskManager } = await cargarModulo(
    path.join(__dirname, '../trading/globalRiskManager.js'),
  );
  const ahora = new Date('2026-06-15T12:00:00Z').getTime();
  const datos = new Map();
  const manager = createGlobalRiskManager({
    storageKey: 'riesgo',
    getNow: () => ahora,
    storage: {
      getItem: key => datos.get(key) || null,
      setItem: (key, value) => datos.set(key, value),
    },
  });
  manager.cargar();
  manager.configurar({
    perdidaMaximaDiaria: 100,
    maxPosicionesAbiertas: 3,
    maxPerdidasConsecutivas: 2,
    pausaMinutos: 30,
  });
  const registros = [
    { estado: 'perdida', pnlNeto: -2, cerradaEn: '2026-06-15T11:30:00Z' },
    { estado: 'perdida', pnlNeto: -2, cerradaEn: '2026-06-15T11:00:00Z' },
  ];

  assert.equal(manager.evaluar({ registros, riesgoOperacion: 1 }).codigo, 'perdidas_consecutivas');
  assert.equal(manager.estado(registros).pausado, true);
  manager.reanudar();
  assert.equal(manager.estado([]).pausado, false);
});

test('una ejecución automática ejecuta la orden y respeta el cooldown', async () => {
  const { createAutoTrader } = await cargarModulo(
    path.join(__dirname, '../trading/autoTrader.js'),
  );
  const ejecutadas = [];
  const trader = createAutoTrader({
    getCooldown: () => 60,
    getNombre: () => 'Mercado automático',
    onLog: () => {},
    execute: (id, tipo, entrada, sl, tp) => {
      ejecutadas.push({ id, tipo, entrada, sl, tp });
    },
    getNow: () => 100000,
  });

  const abierta = await trader.procesar('AUTO', 'BUY', 100, 99, 101.5);
  const repetida = await trader.procesar('AUTO', 'BUY', 100, 99, 101.5);

  assert.equal(abierta, true);
  assert.equal(repetida, false);
  assert.equal(ejecutadas.length, 1);
  assert.deepEqual(ejecutadas[0], { id: 'AUTO', tipo: 'BUY', entrada: 100, sl: 99, tp: 101.5 });
});

test('una ejecución automática fallida no consume el cooldown', async () => {
  const { createAutoTrader } = await cargarModulo(
    path.join(__dirname, '../trading/autoTrader.js'),
  );
  let intentos = 0;
  const trader = createAutoTrader({
    getCooldown: () => 60,
    getNombre: id => id,
    onLog: () => {},
    execute: async () => {
      intentos++;
      if (intentos === 1) throw new Error('Bloqueada');
    },
    getNow: () => 100000,
  });

  await assert.rejects(trader.procesar('TEST', 'BUY', 100, 99, 101));
  assert.equal(trader.cooldownRestante('TEST'), 0);
  assert.equal(await trader.procesar('TEST', 'BUY', 100, 99, 101), true);
});

test('el gráfico de posiciones calcula la media móvil sobre los ticks visibles', async () => {
  const { crearMediaMovil } = await cargarModulo(
    path.join(__dirname, '../components/positionChart.js'),
  );
  const ticks = [
    { epoch: 1, precio: 10 },
    { epoch: 2, precio: 20 },
    { epoch: 3, precio: 30 },
    { epoch: 4, precio: 40 },
  ];
  const media = crearMediaMovil(ticks, 3);

  assert.deepEqual(media.map(item => ({ ...item })), [
    { time: 3, value: 20 },
    { time: 4, value: 30 },
  ]);
});

test('las reglas de estrategia bloquean el automático fuera del horario', async () => {
  const { evaluarReglasEstrategia } = await strategyRules;
  const resultado = evaluarReglasEstrategia({
    config: {
      usarHorario: true,
      horaInicio: '08:00',
      horaFin: '17:00',
      diasPermitidos: [1, 2, 3, 4, 5],
      maxOperacionesHora: 3,
      maxOperacionesDia: 10,
    },
    fecha: new Date('2026-06-16T06:30:00'),
  });

  assert.equal(resultado.permitido, false);
  assert.equal(resultado.codigo, 'schedule');
});

test('las reglas de estrategia respetan horarios que cruzan medianoche', async () => {
  const { estaDentroDeHorario } = await strategyRules;
  const config = {
    usarHorario: true,
    horaInicio: '22:00',
    horaFin: '02:00',
    diasPermitidos: [2],
  };

  assert.equal(estaDentroDeHorario(config, new Date('2026-06-16T23:30:00')), true);
  assert.equal(estaDentroDeHorario(config, new Date('2026-06-16T03:00:00')), false);
});

test('las reglas de estrategia limitan la frecuencia automática por hora y día', async () => {
  const { evaluarReglasEstrategia } = await strategyRules;
  const fecha = new Date('2026-06-16T10:00:00');
  const registros = [
    { origen: 'automatica', abiertaEn: '2026-06-16T09:20:00' },
    { origen: 'automatica', abiertaEn: '2026-06-16T09:45:00' },
    { origen: 'manual', abiertaEn: '2026-06-16T09:50:00' },
  ];

  const resultado = evaluarReglasEstrategia({
    config: {
      usarHorario: true,
      horaInicio: '08:00',
      horaFin: '17:00',
      diasPermitidos: [2],
      maxOperacionesHora: 2,
      maxOperacionesDia: 10,
    },
    registros,
    fecha,
  });

  assert.equal(resultado.permitido, false);
  assert.equal(resultado.codigo, 'frequency');
  assert.equal(resultado.conteo.hora, 2);
});

test('la evaluación semanal resume solo operaciones demo recientes', async () => {
  const { evaluarSemanaTrading, evaluarPreparacionReal } = await cargarModulo(
    path.join(__dirname, '../trading/weeklyEvaluation.js'),
  );
  const now = new Date('2026-06-16T12:00:00Z');
  const registros = [
    { modo: 'demo', estado: 'ganada', pnlNeto: 6, nombre: 'Vol 10', cerradaEn: '2026-06-16T10:00:00Z' },
    { modo: 'demo', estado: 'perdida', pnlNeto: -4, nombre: 'Vol 10', cerradaEn: '2026-06-15T10:00:00Z' },
    { modo: 'simulacion', estado: 'ganada', pnlNeto: 100, nombre: 'Sim', cerradaEn: '2026-06-16T10:00:00Z' },
    { modo: 'demo', estado: 'ganada', pnlNeto: 10, nombre: 'Vieja', cerradaEn: '2026-05-01T10:00:00Z' },
    { modo: 'demo', estado: 'pendiente', pnlNeto: null, nombre: 'Abierta', abiertaEn: '2026-06-16T11:00:00Z' },
  ];

  const evaluacion = evaluarSemanaTrading({ registros, now });
  const preparacion = evaluarPreparacionReal({
    evaluacion,
    registros,
    configRiesgo: { perdidaMaximaDiaria: 50 },
  });

  assert.equal(evaluacion.total, 2);
  assert.equal(evaluacion.ganadas, 1);
  assert.equal(evaluacion.perdidas, 1);
  assert.equal(evaluacion.pnl, 2);
  assert.equal(evaluacion.perdidaAcumulada, 4);
  assert.equal(evaluacion.mejorMercado.key, 'Vol 10');
  assert.equal(preparacion.listo, false);
  assert.equal(preparacion.checks.find(item => item.id === 'riesgo').ok, true);
});

// ── RSI (suavizado de Wilder) ─────────────────────────────────────────────────

test('el RSI con historial mínimo usa el respaldo de promedio simple', async () => {
  const { calcularRSI } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  assert.equal(calcularRSI([100, 101, 99, 102, 100], 14), '50.00');
});

test('el RSI aplica el suavizado de Wilder cuando hay suficiente historial', async () => {
  const { calcularRSI } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  assert.equal(calcularRSI([10, 12, 11, 13, 12, 14, 13, 15], 3), '76.02');
});

test('el RSI llega a 100 cuando el historial solo tiene subidas', async () => {
  const { calcularRSI } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  const precios = Array.from({ length: 21 }, (_, i) => 10 + i);
  assert.equal(calcularRSI(precios, 14), '100.00');
});

test('el RSI es 50 cuando el precio se mantiene sin cambios', async () => {
  const { calcularRSI } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  assert.equal(calcularRSI(Array.from({ length: 16 }, () => 50), 14), '50.00');
});

// ── Filtro de ruido ───────────────────────────────────────────────────────────

test('evaluarSenal ignora movimientos menores al filtro de ruido', async () => {
  const { evaluarSenal } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  const resultado = evaluarSenal({ precio: 100.5, ma: 100, rsi: 50, desviacion: 2 });
  assert.equal(resultado.tipo, 'WAIT');
});

test('evaluarSenal genera BUY cuando el precio supera el filtro de ruido', async () => {
  const { evaluarSenal } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  assert.equal(evaluarSenal({ precio: 102, ma: 100, rsi: 50, desviacion: 2 }).tipo, 'BUY');
});

test('evaluarSenal genera SELL cuando el precio supera el filtro de ruido', async () => {
  const { evaluarSenal } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  assert.equal(evaluarSenal({ precio: 98, ma: 100, rsi: 50, desviacion: 2 }).tipo, 'SELL');
});

// ── Soporte y Resistencia ─────────────────────────────────────────────────────

test('detectarSoporteResistencia devuelve null con historial insuficiente', async () => {
  const { detectarSoporteResistencia } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  const resultado = detectarSoporteResistencia([100, 101, 99]);
  assert.equal(resultado.soporte, null);
  assert.equal(resultado.resistencia, null);
});

test('detectarSoporteResistencia identifica un soporte y una resistencia en historial simple', async () => {
  const { detectarSoporteResistencia } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  // Ciclo claro: sube a 110, baja a 90, sube a 108, precio actual en 100
  const precios = [100,105,110,105,95,90,95,102,108,105,100];
  const { soporte, resistencia } = detectarSoporteResistencia(precios);
  assert.ok(soporte !== null, 'debe detectar soporte');
  assert.ok(resistencia !== null, 'debe detectar resistencia');
  assert.ok(soporte < 100, 'soporte debe estar por debajo del precio actual');
  assert.ok(resistencia > 100, 'resistencia debe estar por encima del precio actual');
});

test('evaluarSenal bloquea BUY cuando el precio está dentro del 1% de la resistencia', async () => {
  const { evaluarSenal } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  // Precio en 104.5, resistencia en 105 → diferencia 0.48% < 1% → debe bloquear
  const resultado = evaluarSenal({
    precio: 104.5, ma: 100, rsi: 50, desviacion: 2,
    resistencia: 105,
  });
  assert.equal(resultado.tipo, 'WAIT');
});

test('evaluarSenal bloquea SELL cuando el precio está dentro del 1% de un soporte', async () => {
  const { evaluarSenal } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  // Precio en 95.5, soporte en 95 → diferencia 0.53% < 1% → debe bloquear
  const resultado = evaluarSenal({
    precio: 95.5, ma: 100, rsi: 50, desviacion: 2,
    soporte: 95,
  });
  assert.equal(resultado.tipo, 'WAIT');
});

test('evaluarSenal permite BUY cuando la resistencia está lejos', async () => {
  const { evaluarSenal } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  const resultado = evaluarSenal({
    precio: 102, ma: 100, rsi: 50, desviacion: 2,
    resistencia: 115,
  });
  assert.equal(resultado.tipo, 'BUY');
});

// ── Defaults de señales ───────────────────────────────────────────────────────

test('la configuración de señales usa el umbral y confirmaciones por defecto correctos', async () => {
  const { normalizarSignalConfig, SIGNAL_CONFIG_DEFAULTS } = await cargarModulo(
    path.join(__dirname, '../trading/signalScorer.js'),
  );
  assert.equal(SIGNAL_CONFIG_DEFAULTS.umbralMinimo, 65);
  assert.equal(SIGNAL_CONFIG_DEFAULTS.confirmacionesRequeridas, 2);
  assert.deepEqual(normalizarSignalConfig({}), SIGNAL_CONFIG_DEFAULTS);
});

// ── Patrones de velas (Módulo 3 del ebook de Billy Chacón) ───────────────────

test('detecta Martillo correctamente', async () => {
  const { esMartillo } = await cargarModulo(path.join(__dirname, '../trading/candlePatterns.js'));
  // Cuerpo pequeño arriba, mecha inferior larga
  assert.equal(esMartillo({ open: 100, close: 101, high: 101.5, low: 96 }), true);
  assert.equal(esMartillo({ open: 100, close: 105, high: 106, low: 99 }), false);
});

test('detecta Envolvente alcista correctamente', async () => {
  const { esEnvolventeAlcista } = await cargarModulo(path.join(__dirname, '../trading/candlePatterns.js'));
  const velas = [
    { open: 105, close: 100, high: 106, low: 99 },  // bajista
    { open: 99,  close: 106, high: 107, low: 98 },  // alcista que envuelve
  ];
  assert.equal(esEnvolventeAlcista(velas), true);
});

test('detecta Envolvente bajista correctamente', async () => {
  const { esEnvolventeBajista } = await cargarModulo(path.join(__dirname, '../trading/candlePatterns.js'));
  const velas = [
    { open: 100, close: 105, high: 106, low: 99 },  // alcista
    { open: 106, close: 99,  high: 107, low: 98 },  // bajista que envuelve
  ];
  assert.equal(esEnvolventeBajista(velas), true);
});

test('detecta Doji correctamente', async () => {
  const { esDoji } = await cargarModulo(path.join(__dirname, '../trading/candlePatterns.js'));
  assert.equal(esDoji({ open: 100, close: 100.05, high: 102, low: 98 }), true);
  assert.equal(esDoji({ open: 100, close: 105, high: 106, low: 99 }), false);
});

test('evaluarPatronesVela sube la puntuación cuando el patrón confirma la señal', async () => {
  const { evaluarPatronesVela } = await cargarModulo(path.join(__dirname, '../trading/candlePatterns.js'));
  // Envolvente alcista + señal BUY → bonificación positiva
  const velas = [
    { open: 105, close: 100, high: 106, low: 99 },
    { open: 99,  close: 106, high: 107, low: 98 },
  ];
  const resultado = evaluarPatronesVela(velas, 'BUY');
  assert.ok(resultado.bonificacion > 0, 'debe dar bonificación positiva');
  assert.ok(resultado.patronAlcista !== null, 'debe detectar patrón alcista');
});

test('evaluarPatronesVela baja la puntuación cuando el patrón contradice la señal', async () => {
  const { evaluarPatronesVela } = await cargarModulo(path.join(__dirname, '../trading/candlePatterns.js'));
  // Envolvente bajista + señal BUY → bonificación negativa
  const velas = [
    { open: 100, close: 105, high: 106, low: 99 },
    { open: 106, close: 99,  high: 107, low: 98 },
  ];
  const resultado = evaluarPatronesVela(velas, 'BUY');
  assert.ok(resultado.bonificacion < 0, 'debe dar bonificación negativa');
});

// ── Tendencia y EMA (críticos 1 y 3 del ebook) ───────────────────────────────

test('calcularEMA devuelve el precio inicial con un solo dato', async () => {
  const { calcularEMA } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  assert.equal(calcularEMA([100], 14), 100);
});

test('calcularEMA pondera más los datos recientes que la MA simple', async () => {
  const { calcularEMA, calcularMA } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  const precios = [100, 100, 100, 100, 100, 110];
  const ema = calcularEMA(precios, 5);
  const ma = calcularMA(precios);
  assert.ok(ema > ma, 'EMA debe ser mayor que MA cuando los datos recientes suben');
});

test('clasificarTendencia detecta tendencia alcista cuando precio > EMA y hay HH/HL', async () => {
  const { clasificarTendencia } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  const precios = Array.from({ length: 30 }, (_, i) => 100 + i * 0.5 + (i % 3 === 0 ? -0.2 : 0));
  const resultado = clasificarTendencia(precios, 20);
  assert.equal(resultado, 'alcista');
});

test('clasificarTendencia detecta tendencia bajista cuando precio < EMA', async () => {
  const { clasificarTendencia } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  const precios = Array.from({ length: 30 }, (_, i) => 100 - i * 0.5);
  const resultado = clasificarTendencia(precios, 20);
  assert.equal(resultado, 'bajista');
});

test('clasificarTendencia devuelve lateral con historial insuficiente', async () => {
  const { clasificarTendencia } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  assert.equal(clasificarTendencia([100, 101, 99], 20), 'lateral');
});

test('evaluarSenal bloquea BUY en tendencia bajista', async () => {
  const { evaluarSenal } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  const resultado = evaluarSenal({
    precio: 102, ma: 100, rsi: 50, desviacion: 2, tendencia: 'bajista',
  });
  assert.equal(resultado.tipo, 'WAIT');
});

test('evaluarSenal bloquea SELL en tendencia alcista', async () => {
  const { evaluarSenal } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  const resultado = evaluarSenal({
    precio: 98, ma: 100, rsi: 50, desviacion: 2, tendencia: 'alcista',
  });
  assert.equal(resultado.tipo, 'WAIT');
});

test('evaluarSenal permite BUY en tendencia alcista', async () => {
  const { evaluarSenal } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  const resultado = evaluarSenal({
    precio: 102, ma: 100, rsi: 50, desviacion: 2, tendencia: 'alcista',
  });
  assert.equal(resultado.tipo, 'BUY');
  assert.equal(resultado.tendencia, 'alcista');
});

test('evaluarSenal permite SELL en tendencia bajista', async () => {
  const { evaluarSenal } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  const resultado = evaluarSenal({
    precio: 98, ma: 100, rsi: 50, desviacion: 2, tendencia: 'bajista',
  });
  assert.equal(resultado.tipo, 'SELL');
  assert.equal(resultado.tendencia, 'bajista');
});

// ── Contexto de patrón de vela (crítico 2 del ebook) ─────────────────────────

test('evaluarPatronesVela ignora Martillo sin caída previa', async () => {
  const { evaluarPatronesVela } = await cargarModulo(path.join(__dirname, '../trading/candlePatterns.js'));
  const velasMartillo = [
    { open: 100, close: 101, high: 101.5, low: 96 },
    { open: 102, close: 103, high: 103.5, low: 101 },
    { open: 103, close: 104, high: 104.5, low: 102 },
    { open: 104, close: 105, high: 105.5, low: 103 },
    { open: 105, close: 106, high: 106.5, low: 104 },
    { open: 106, close: 107, high: 107.2, low: 102 },
  ];
  const resultado = evaluarPatronesVela(velasMartillo, 'BUY');
  assert.equal(resultado.patronAlcista, null, 'Martillo sin caída previa no debe contar');
});

test('evaluarPatronesVela detecta Martillo con caída previa', async () => {
  const { evaluarPatronesVela } = await cargarModulo(path.join(__dirname, '../trading/candlePatterns.js'));
  // Martillo válido: cuerpo pequeño arriba, mecha inferior >= 2x cuerpo, mecha superior <= 0.5x cuerpo.
  const velasConCaida = [
    { open: 107, close: 105, high: 107.5, low: 104 },
    { open: 105, close: 103, high: 105.5, low: 102 },
    { open: 103, close: 101, high: 103.5, low: 100 },
    { open: 101, close: 100, high: 101.5, low: 99  },
    { open: 100.8, close: 101, high: 101.1, low: 96 },
  ];
  const resultado = evaluarPatronesVela(velasConCaida, 'BUY');
  assert.equal(resultado.patronAlcista, 'Martillo');
  assert.ok(resultado.bonificacion > 0);
});

// ── Detección de mercado lateral / en rango ────────────────────────────────────

test('detectarRango identifica mercado en rango por banda estrecha y RSI neutro', async () => {
  const { detectarRango } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  // Precio oscilando en banda muy estrecha (< 0.5%) con RSI neutro
  const precios = Array.from({ length: 20 }, (_, i) => 100 + (i % 2 === 0 ? 0.1 : -0.1));
  const resultado = detectarRango(precios, 50, 99.8, 100.2);
  assert.equal(resultado.enRango, true, 'debe detectar rango por banda estrecha y RSI neutro');
});

test('detectarRango no marca rango en mercado con tendencia clara', async () => {
  const { detectarRango } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  // Precio subiendo sostenidamente, RSI alto
  const precios = Array.from({ length: 20 }, (_, i) => 100 + i * 0.5);
  const resultado = detectarRango(precios, 72, null, null);
  assert.equal(resultado.enRango, false, 'no debe marcar rango en tendencia clara');
});

test('evaluarSenal devuelve WAIT cuando el mercado está en rango', async () => {
  const { evaluarSenal } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  const resultado = evaluarSenal({
    precio: 102, ma: 100, rsi: 50, desviacion: 2,
    tendencia: 'alcista', enRango: true,
  });
  assert.equal(resultado.tipo, 'WAIT', 'debe bloquear señal en mercado en rango');
});

test('detectarRango devuelve historial insuficiente con pocos datos', async () => {
  const { detectarRango } = await cargarModulo(path.join(__dirname, '../trading/strategy.js'));
  const resultado = detectarRango([100, 101, 99], 50, null, null);
  assert.equal(resultado.enRango, false);
  assert.equal(resultado.razon, 'historial insuficiente');
});
