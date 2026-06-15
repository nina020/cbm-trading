import { calcularPnlSimulado, evaluarSalidaPorPrecio } from './riskManager.js';

export function createSimulationEngine({
  storageKey,
  getStake,
  getMultiplier = () => null,
  getNombre,
  onChange,
  onLog,
  onOpen,
  onClose,
  storage = localStorage,
}) {
  let posiciones = [];

  function guardar() {
    storage.setItem(storageKey, JSON.stringify(posiciones));
  }

  function notificar() {
    guardar();
    onChange(posiciones);
  }

  return {
    cargar() {
      try {
        const data = JSON.parse(storage.getItem(storageKey) || '[]');
        posiciones = Array.isArray(data) ? data : [];
      } catch (error) {
        posiciones = [];
        console.error('No se pudieron cargar las posiciones simuladas:', error);
      }
      onChange(posiciones);
    },
    abrir(mercadoId, tipo, entrada, sl, tp, origen = 'manual') {
      const posicion = {
        id: `sim-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        mercadoId,
        nombre: getNombre(mercadoId),
        tipo,
        entrada,
        precioActual: entrada,
        sl,
        tp,
        stake: getStake(),
        multiplicador: getMultiplier(),
        pnl: 0,
        origen,
        abiertaEn: new Date().toISOString(),
      };
      posiciones.unshift(posicion);
      notificar();
      onOpen?.(posicion);
      onLog(`${posicion.nombre} ${tipo}: posición simulada abierta por $${posicion.stake.toFixed(2)}.`, 'success');
      return posicion;
    },
    actualizar(mercadoId, precio) {
      let cambios = false;
      posiciones = posiciones.filter(pos => {
        if (pos.mercadoId !== mercadoId) return true;
        pos.precioActual = precio;
        pos.pnl = calcularPnlSimulado({
          stake: pos.stake,
          tipo: pos.tipo,
          entrada: pos.entrada,
          precio,
          sl: pos.sl,
          tp: pos.tp,
        });
        const salida = evaluarSalidaPorPrecio({
          tipo: pos.tipo,
          entrada: pos.entrada,
          precio,
          sl: pos.sl,
          tp: pos.tp,
        });
        cambios = true;
        if (salida) {
          onClose?.(pos, pos.pnl);
          onLog(`${pos.nombre} ${pos.tipo}: simulación cerrada por ${salida === 'take_profit' ? 'take profit' : 'stop loss'} (${pos.pnl >= 0 ? '+' : '-'}$${Math.abs(pos.pnl).toFixed(2)}).`, salida === 'take_profit' ? 'success' : 'error');
          return false;
        }
        return true;
      });
      if (cambios) notificar();
    },
    cerrar(id) {
      const posicion = posiciones.find(pos => pos.id === id);
      if (!posicion) return;
      posiciones = posiciones.filter(pos => pos.id !== id);
      notificar();
      onClose?.(posicion, posicion.pnl);
      onLog(`${posicion.nombre} ${posicion.tipo}: simulación cerrada manualmente (${posicion.pnl >= 0 ? '+' : '-'}$${Math.abs(posicion.pnl).toFixed(2)}).`, posicion.pnl >= 0 ? 'success' : 'error');
    },
    get posiciones() { return posiciones; },
  };
}
