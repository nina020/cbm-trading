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
    { inversion: 5, riesgo: 4.5, objetivo: 6.75 },
    { inversion: 20, riesgo: 18, objetivo: 27 },
    { inversion: 100, riesgo: 90, objetivo: 135 },
  ]);
  assert.equal(objetivos[1].objetivo / objetivos[0].objetivo, 4);
});

test('el P&L al alcanzar take profit escala con la inversión', async () => {
  const { calcularPnlSimulado } = await riskManager;
  const pnl5 = calcularPnlSimulado({ ...operacionBuy, stake: 5, precio: operacionBuy.tp });
  const pnl20 = calcularPnlSimulado({ ...operacionBuy, stake: 20, precio: operacionBuy.tp });
  const pnl100 = calcularPnlSimulado({ ...operacionBuy, stake: 100, precio: operacionBuy.tp });

  assert.equal(pnl5, 6.75);
  assert.equal(pnl20, 27);
  assert.equal(pnl100, 135);
  assert.equal(pnl20 / pnl5, 4);
});

test('el P&L al alcanzar stop loss escala con la inversión', async () => {
  const { calcularPnlSimulado } = await riskManager;
  const pnl5 = calcularPnlSimulado({ ...operacionBuy, stake: 5, precio: operacionBuy.sl });
  const pnl20 = calcularPnlSimulado({ ...operacionBuy, stake: 20, precio: operacionBuy.sl });

  assert.equal(pnl5, -4.5);
  assert.equal(pnl20, -18);
  assert.equal(pnl20 / pnl5, 4);
});

test('el cálculo funciona igual para operaciones SELL', async () => {
  const { calcularPnlSimulado } = await riskManager;
  const pnl = calcularPnlSimulado({
    stake: 20,
    tipo: 'SELL',
    entrada: 100,
    sl: 101,
    tp: 98.5,
    precio: 98.5,
  });

  assert.equal(pnl, 27);
});

test('BUY y SELL detectan SL/TP exactos y saltos más allá del nivel', async () => {
  const { evaluarSalidaPorPrecio } = await riskManager;

  assert.equal(evaluarSalidaPorPrecio({ ...operacionBuy, precio: 101.5 }), 'take_profit');
  assert.equal(evaluarSalidaPorPrecio({ ...operacionBuy, precio: 103 }), 'take_profit');
  assert.equal(evaluarSalidaPorPrecio({ ...operacionBuy, precio: 99 }), 'stop_loss');
  assert.equal(evaluarSalidaPorPrecio({ ...operacionBuy, precio: 97 }), 'stop_loss');
  assert.equal(evaluarSalidaPorPrecio({ ...operacionBuy, precio: 100.5 }), null);

  const operacionSell = { tipo: 'SELL', entrada: 100, sl: 101, tp: 98.5 };
  assert.equal(evaluarSalidaPorPrecio({ ...operacionSell, precio: 98.5 }), 'take_profit');
  assert.equal(evaluarSalidaPorPrecio({ ...operacionSell, precio: 97 }), 'take_profit');
  assert.equal(evaluarSalidaPorPrecio({ ...operacionSell, precio: 101 }), 'stop_loss');
  assert.equal(evaluarSalidaPorPrecio({ ...operacionSell, precio: 103 }), 'stop_loss');
  assert.equal(evaluarSalidaPorPrecio({ ...operacionSell, precio: 99.5 }), null);
});

test('niveles invertidos no provocan cierres automáticos incorrectos', async () => {
  const { evaluarSalidaPorPrecio } = await riskManager;

  assert.equal(evaluarSalidaPorPrecio({
    tipo: 'BUY',
    entrada: 100,
    sl: 101,
    tp: 99,
    precio: 102,
  }), null);
});

test('el motor de simulación conserva la proporción al cerrar operaciones', async () => {
  const { createSimulationEngine } = await cargarModulo(
    path.join(__dirname, '../trading/simulationEngine.js'),
  );

  async function simular(stake) {
    let resultado;
    const datos = new Map();
    const engine = createSimulationEngine({
      storageKey: 'prueba',
      getStake: () => stake,
      getNombre: () => 'Mercado de prueba',
      onChange: () => {},
      onLog: () => {},
      onClose: (_posicion, pnl) => { resultado = pnl; },
      storage: {
        getItem: key => datos.get(key) || null,
        setItem: (key, value) => datos.set(key, value),
      },
    });

    engine.abrir('TEST', 'BUY', 100, 99, 101.5);
    engine.actualizar('TEST', 101.5);
    return resultado;
  }

  const pnl5 = await simular(5);
  const pnl20 = await simular(20);

  assert.equal(pnl5, 6.75);
  assert.equal(pnl20, 27);
  assert.equal(pnl20 / pnl5, 4);
});

test('el motor limita el resultado cuando el precio salta más allá de TP o SL', async () => {
  const { createSimulationEngine } = await cargarModulo(
    path.join(__dirname, '../trading/simulationEngine.js'),
  );

  function simular(precioSalida) {
    let resultado;
    const engine = createSimulationEngine({
      storageKey: 'saltos',
      getStake: () => 20,
      getNombre: () => 'Mercado de prueba',
      onChange: () => {},
      onLog: () => {},
      onClose: (_posicion, pnl) => { resultado = pnl; },
      storage: { getItem: () => null, setItem: () => {} },
    });

    engine.abrir('TEST', 'BUY', 100, 99, 101.5);
    engine.actualizar('TEST', precioSalida);
    return resultado;
  }

  assert.equal(simular(110), 27);
  assert.equal(simular(90), -18);
});

test('el cierre manual conserva el P&L del último precio observado', async () => {
  const { createSimulationEngine } = await cargarModulo(
    path.join(__dirname, '../trading/simulationEngine.js'),
  );
  let resultado;
  const engine = createSimulationEngine({
    storageKey: 'manual',
    getStake: () => 20,
    getNombre: () => 'Mercado de prueba',
    onChange: () => {},
    onLog: () => {},
    onClose: (_posicion, pnl) => { resultado = pnl; },
    storage: { getItem: () => null, setItem: () => {} },
  });

  const posicion = engine.abrir('TEST', 'BUY', 100, 99, 101.5);
  engine.actualizar('TEST', 100.75);
  engine.cerrar(posicion.id);

  assert.equal(resultado, 13.5);
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

  assert.equal(payload.limit_order.stop_loss, 18);
  assert.equal(payload.limit_order.take_profit, 27);
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
    confirmacionesRequeridas: 3,
    filtrarAutoTrading: false,
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

test('el resumen de backtesting agrupa resultados por calidad', async () => {
  const { resumirCalidad } = await cargarModulo(
    path.join(__dirname, '../trading/backtestEngine.js'),
  );
  const resumen = resumirCalidad([
    { calidad: 65, resultado: 'perdida', pnl: -4 },
    { calidad: 74, resultado: 'ganada', pnl: 6 },
    { calidad: 78, resultado: 'perdida', pnl: -4 },
    { calidad: 85, resultado: 'ganada', pnl: 6 },
    { calidad: 92, resultado: 'ganada', pnl: 6 },
  ]);

  assert.deepEqual(resumen.map(item => ({
    etiqueta: item.etiqueta,
    total: item.total,
    winRate: item.winRate,
    pnl: item.pnl,
  })), [
    { etiqueta: '<70', total: 1, winRate: 0, pnl: -4 },
    { etiqueta: '70–79', total: 2, winRate: 50, pnl: 2 },
    { etiqueta: '80–89', total: 1, winRate: 100, pnl: 6 },
    { etiqueta: '90–100', total: 1, winRate: 100, pnl: 6 },
  ]);
});

test('la comparativa histórica respeta cada umbral sobre la misma muestra', async () => {
  const { ejecutarComparativaBacktest } = await cargarModulo(
    path.join(__dirname, '../trading/backtestEngine.js'),
  );
  const ticks = Array.from({ length: 600 }, (_, index) => ({
    epoch: index + 1,
    precio: 100
      + Math.sin(index / 8) * 4
      + Math.sin(index / 2) * 0.6,
  }));
  const resultado = ejecutarComparativaBacktest({
    ticks,
    periodo: 14,
    stake: 20,
    saldoInicial: 10000,
    confirmacionesRequeridas: 3,
    umbralSeleccionado: 70,
  });

  assert.deepEqual(
    resultado.comparativa.map(item => item.umbralMinimo),
    [null, 70, 80, 90],
  );
  resultado.comparativa
    .filter(item => item.umbralMinimo !== null)
    .forEach(item => {
      assert.ok(item.operaciones.every(
        operacion => operacion.calidad >= item.umbralMinimo,
      ));
    });
  assert.equal(
    resultado.calidad.reduce((total, grupo) => total + grupo.total, 0),
    resultado.comparativa[0].total,
  );
});

test('la calibración recomienda el mejor equilibrio con muestra suficiente', async () => {
  const { recomendarCalibracion } = await cargarModulo(
    path.join(__dirname, '../trading/marketCalibration.js'),
  );
  const recomendacion = recomendarCalibracion([
    { umbralMinimo: null, total: 20, winRate: 50, pnl: 20, maxDrawdown: 30 },
    { umbralMinimo: 70, total: 10, winRate: 60, pnl: 30, maxDrawdown: 20 },
    { umbralMinimo: 80, total: 7, winRate: 71, pnl: 28, maxDrawdown: 10 },
    { umbralMinimo: 90, total: 2, winRate: 100, pnl: 20, maxDrawdown: 0 },
  ], { confirmacionesRequeridas: 3, minimoOperaciones: 3 });

  assert.equal(recomendacion.disponible, true);
  assert.equal(recomendacion.umbralMinimo, 80);
  assert.equal(recomendacion.confirmacionesRequeridas, 3);
});

test('la calibración no recomienda resultados con muestra insuficiente', async () => {
  const { recomendarCalibracion } = await cargarModulo(
    path.join(__dirname, '../trading/marketCalibration.js'),
  );
  const recomendacion = recomendarCalibracion([
    { umbralMinimo: 70, total: 1, winRate: 100, pnl: 10, maxDrawdown: 0 },
    { umbralMinimo: 80, total: 2, winRate: 100, pnl: 20, maxDrawdown: 0 },
  ]);

  assert.equal(recomendacion.disponible, false);
});

test('las calibraciones se guardan y consultan por mercado independiente', async () => {
  const { createMarketCalibrationStore } = await cargarModulo(
    path.join(__dirname, '../trading/marketCalibration.js'),
  );
  const datos = new Map();
  const store = createMarketCalibrationStore({
    storageKey: 'calibraciones',
    storage: {
      getItem: key => datos.get(key) || null,
      setItem: (key, value) => datos.set(key, value),
    },
  });

  store.cargar();
  store.establecer('BOOM500', { umbralMinimo: 80, confirmacionesRequeridas: 3 });
  store.establecer('CRASH500', { umbralMinimo: 90, confirmacionesRequeridas: 4 });

  assert.equal(store.obtener('BOOM500').umbralMinimo, 80);
  assert.equal(store.obtener('CRASH500').umbralMinimo, 90);
  store.eliminar('BOOM500');
  assert.equal(store.obtener('BOOM500'), null);
  assert.equal(store.obtener('CRASH500').confirmacionesRequeridas, 4);
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

test('el ranking prioriza un mercado estable con mejor señal e historial', async () => {
  const { ordenarMercadosParaInicio } = await cargarModulo(
    path.join(__dirname, '../trading/marketRanking.js'),
  );
  const registros = Array.from({ length: 10 }, (_, index) => ({
    mercadoId: 'ESTABLE',
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
      calibracion: { umbralMinimo: 75 },
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
    registros: [{ mercadoId: 'TEST', estado: 'ganada' }],
  });
  const veinteGanadas = evaluarMercadoParaInicio({
    ...base,
    registros: Array.from({ length: 20 }, () => ({
      mercadoId: 'TEST',
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

  assert.equal(maxPosiciones.codigo, 'max_posiciones');
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

test('una ejecución automática abre una simulación visible con origen automático', async () => {
  const { createAutoTrader } = await cargarModulo(
    path.join(__dirname, '../trading/autoTrader.js'),
  );
  const { createSimulationEngine } = await cargarModulo(
    path.join(__dirname, '../trading/simulationEngine.js'),
  );
  let posicionesRenderizadas = [];
  const engine = createSimulationEngine({
    storageKey: 'automaticas',
    getStake: () => 5,
    getNombre: () => 'Mercado automático',
    onChange: posiciones => { posicionesRenderizadas = posiciones.map(item => ({ ...item })); },
    onLog: () => {},
    storage: {
      getItem: () => null,
      setItem: () => {},
    },
  });
  engine.cargar();
  const trader = createAutoTrader({
    getCooldown: () => 60,
    getNombre: () => 'Mercado automático',
    onLog: () => {},
    execute: (id, tipo, entrada, sl, tp) => {
      engine.abrir(id, tipo, entrada, sl, tp, 'automatica');
    },
  });

  const abierta = await trader.procesar('AUTO', 'BUY', 100, 99, 101.5);

  assert.equal(abierta, true);
  assert.equal(posicionesRenderizadas.length, 1);
  assert.equal(posicionesRenderizadas[0].origen, 'automatica');
  assert.equal(posicionesRenderizadas[0].mercadoId, 'AUTO');
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
