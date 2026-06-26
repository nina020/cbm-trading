export function createOrderAudit({ storageKey, onChange = () => {}, storage = localStorage, limit = 300 }) {
  let eventos = [];

  function guardar() {
    storage.setItem(storageKey, JSON.stringify(eventos.slice(0, limit)));
    onChange(eventos);
  }

  return {
    cargar() {
      try {
        const data = JSON.parse(storage.getItem(storageKey) || '[]');
        eventos = Array.isArray(data) ? data.slice(0, limit) : [];
      } catch (error) {
        eventos = [];
        console.error('No se pudo cargar la auditoría de órdenes:', error);
      }
      onChange(eventos);
    },
    registrar(evento = {}) {
      const registro = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fecha: new Date().toISOString(),
        nivel: evento.nivel || 'info',
        etapa: evento.etapa || 'evento',
        modo: evento.modo || null,
        mercadoId: evento.mercadoId || null,
        nombre: evento.nombre || evento.mercadoId || null,
        tipo: evento.tipo || null,
        origen: evento.origen || null,
        contratoId: evento.contratoId || null,
        stake: evento.stake ?? null,
        riesgo: evento.riesgo ?? null,
        objetivo: evento.objetivo ?? null,
        detalle: evento.detalle || '',
        datos: evento.datos || null,
      };
      eventos.unshift(registro);
      guardar();
      return registro;
    },
    limpiar() {
      eventos = [];
      storage.removeItem(storageKey);
      onChange(eventos);
    },
    get eventos() {
      return eventos;
    },
  };
}
