export function determinarEstadoAutomatico({
  activo,
  tipo = 'WAIT',
  puntuacion = 0,
  config,
  confirmaciones = 0,
  cooldownRestante = 0,
  estadoForzado = null,
  motivoForzado = null,
}) {
  if (!activo) {
    return { codigo: 'off', titulo: 'Automático apagado', motivo: 'Activa la casilla para evaluar y ejecutar señales.' };
  }
  if (estadoForzado === 'opening') {
    return { codigo: 'opening', titulo: 'Abriendo operación', motivo: 'La señal cumplió todos los requisitos.' };
  }
  if (estadoForzado === 'executed') {
    return { codigo: 'executed', titulo: 'Operación enviada', motivo: 'Esperando una nueva señal o el fin del cooldown.' };
  }
  if (estadoForzado === 'error') {
    return { codigo: 'error', titulo: 'Error de ejecución', motivo: 'La operación podrá reintentarse si la señal continúa válida.' };
  }
  if (estadoForzado === 'schedule') {
    return { codigo: 'schedule', titulo: 'Fuera de horario', motivo: motivoForzado || 'La señal se notificará, pero no se ejecutará automáticamente.' };
  }
  if (estadoForzado === 'frequency') {
    return { codigo: 'frequency', titulo: 'Frecuencia limitada', motivo: motivoForzado || 'La señal cumple, pero se alcanzó el límite configurado.' };
  }
  if (tipo === 'WAIT') {
    return { codigo: 'waiting', titulo: 'Esperando señal', motivo: 'Aún no hay una dirección BUY o SELL válida.' };
  }
  if (cooldownRestante > 0) {
    return { codigo: 'cooldown', titulo: 'En cooldown', motivo: `Puede reintentar en ${cooldownRestante}s.` };
  }
  if (config.filtrarAutoTrading && puntuacion < config.umbralMinimo) {
    return {
      codigo: 'quality',
      titulo: 'Calidad insuficiente',
      motivo: `Necesita ${config.umbralMinimo}/100 y tiene ${puntuacion}/100.`,
    };
  }
  if (
    config.filtrarAutoTrading
    && confirmaciones < config.confirmacionesRequeridas
  ) {
    return {
      codigo: 'confirming',
      titulo: 'Confirmando señal',
      motivo: `Confirmación ${confirmaciones} de ${config.confirmacionesRequeridas}.`,
    };
  }
  return { codigo: 'ready', titulo: 'Señal lista', motivo: 'Cumple calidad y confirmaciones para ejecutar.' };
}

export function renderAutoStatus(contenedor, datos) {
  if (!contenedor) return;
  const estado = determinarEstadoAutomatico(datos);
  const config = datos.config;
  const calibracion = datos.calibrado ? 'Calibración del mercado' : 'Configuración global';

  contenedor.className = `auto-status auto-status-${estado.codigo}`;
  contenedor.innerHTML = `
    <div class="auto-status-head">
      <strong>${estado.titulo}</strong>
      <span>${datos.tipo === 'WAIT' ? 'Sin señal' : datos.tipo}</span>
    </div>
    <div class="auto-status-grid">
      <div><small>Calidad</small><b>${datos.puntuacion || 0}/100</b></div>
      <div><small>Umbral</small><b>${config.umbralMinimo}/100</b></div>
      <div><small>Confirmaciones</small><b>${datos.confirmaciones || 0}/${config.confirmacionesRequeridas}</b></div>
      <div><small>Cooldown</small><b>${datos.cooldownRestante || 0}s</b></div>
    </div>
    <div class="auto-status-reason">${estado.motivo}</div>
    <div class="auto-status-source">${calibracion}</div>
  `;
}
