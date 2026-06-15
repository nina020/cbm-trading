export function createAutoTrader({
  getCooldown, getNombre, onLog, execute, getNow = () => Date.now(),
}) {
  const activos = {};
  const ultimaEjecucion = {};

  return {
    toggle(id, activo) {
      activos[id] = activo;
      onLog(
        activo
          ? `🟢 ${getNombre(id)}: ejecución automática ACTIVADA — cada señal nueva se ejecutará sola (cooldown ${getCooldown()}s).`
          : `🔴 ${getNombre(id)}: ejecución automática DESACTIVADA.`,
        activo ? 'success' : 'info',
      );
    },
    estaActivo(id) {
      return Boolean(activos[id]);
    },
    eliminar(id) {
      delete activos[id];
      delete ultimaEjecucion[id];
    },
    cooldownRestante(id) {
      const transcurrido = getNow() - (ultimaEjecucion[id] || 0);
      return Math.max(0, Math.ceil((getCooldown() * 1000 - transcurrido) / 1000));
    },
    async procesar(mercadoId, tipo, entrada, sl, tp) {
      const ahora = getNow();
      const cooldownMs = getCooldown() * 1000;
      if (ahora - (ultimaEjecucion[mercadoId] || 0) < cooldownMs) return false;
      await execute(mercadoId, tipo, entrada, sl, tp);
      ultimaEjecucion[mercadoId] = ahora;
      return true;
    },
  };
}
