export function createExecutionJournal({ storageKey, onChange, storage = localStorage }) {
  let registros = [];

  function numeroOpcional(value) {
    if (value === null || value === undefined || value === '') return null;
    const numero = Number(value);
    return Number.isFinite(numero) ? numero : null;
  }

  function guardar() {
    storage.setItem(storageKey, JSON.stringify(registros));
    onChange(registros);
  }

  return {
    cargar() {
      try {
        const data = JSON.parse(storage.getItem(storageKey) || '[]');
        registros = Array.isArray(data) ? data : [];
      } catch (error) {
        registros = [];
        console.error('No se pudo cargar el registro de ejecuciones:', error);
      }
      onChange(registros);
    },
    abrir({
      id, mercadoId, nombre, tipo, modo, origen, stake, entrada,
      multiplicador = null, precioCotizado = null, costosReportados = null,
      stopLossAmount = null, takeProfitAmount = null,
      tipoEjecucion = null,
      // Cambio #17: datos de contexto de análisis para aprendizaje posterior.
      patron = null, confirmaciones = null, tendencia = null, calidad = null,
    }) {
      const existente = registros.find(item => String(item.id) === String(id));
      if (existente) return existente;
      const registro = {
        id,
        mercadoId,
        nombre,
        tipo,
        modo,
        origen,
        tipoEjecucion,
        stake,
        entrada,
        multiplicador,
        precioCotizado,
        stopLossAmount,
        takeProfitAmount,
        costos: costosReportados,
        pnlBruto: null,
        pnlNeto: null,
        estado: 'pendiente',
        pnl: null,
        abiertaEn: new Date().toISOString(),
        cerradaEn: null,
        // Cambio #17: contexto de análisis al momento de la ejecución.
        patron,
        confirmaciones,
        tendencia,
        calidad,
      };
      registros.unshift(registro);
      guardar();
      return registro;
    },
    cerrar(id, resultado) {
      const registro = registros.find(item => String(item.id) === String(id));
      if (!registro || registro.estado !== 'pendiente') return false;
      const datos = typeof resultado === 'object' && resultado !== null
        ? resultado
        : { pnlNeto: resultado };
      const pnlNeto = Number(datos.pnlNeto ?? datos.pnl) || 0;
      const costosResultado = numeroOpcional(datos.costos);
      const costos = costosResultado === null
        ? numeroOpcional(registro.costos)
        : Math.abs(costosResultado);
      const brutoResultado = numeroOpcional(datos.pnlBruto);
      const pnlBruto = brutoResultado ?? (costos === null ? null : pnlNeto + costos);

      registro.costos = costos ?? null;
      registro.pnlBruto = pnlBruto;
      registro.pnlNeto = pnlNeto;
      registro.pnl = pnlNeto;
      registro.estado = pnlNeto >= 0 ? 'ganada' : 'perdida';
      registro.cerradaEn = new Date().toISOString();
      guardar();
      return true;
    },
    limpiar() {
      registros = [];
      storage.removeItem(storageKey);
      onChange(registros);
    },
    depurarModo(modo) {
      const filtrados = registros.filter(item => item.modo !== modo);
      if (filtrados.length === registros.length) return false;
      registros = filtrados;
      guardar();
      return true;
    },
    get registros() {
      return registros;
    },
    obtener(id) {
      return registros.find(item => String(item.id) === String(id)) || null;
    },
  };
}
