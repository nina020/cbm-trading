function numeroOpcional(value) {
  if (value === null || value === undefined || value === '') return null;
  const numero = Number(value);
  return Number.isFinite(numero) ? Math.abs(numero) : null;
}

function montoLimite(limite) {
  if (limite === null || limite === undefined) return null;
  if (typeof limite !== 'object') return null;
  return numeroOpcional(
    limite.order_amount
    ?? limite.amount
    ?? limite.loss_amount
    ?? limite.profit_amount,
  );
}

export function resolverLimitesMonetarios({ contrato = {}, registro = null, objetivos = null }) {
  const limitOrder = contrato.limit_order || {};
  return {
    stopLossAmount: montoLimite(limitOrder.stop_loss)
      ?? numeroOpcional(registro?.stopLossAmount)
      ?? numeroOpcional(objetivos?.riesgo),
    takeProfitAmount: montoLimite(limitOrder.take_profit)
      ?? numeroOpcional(registro?.takeProfitAmount)
      ?? numeroOpcional(objetivos?.objetivo),
  };
}

function dineroLimite(value) {
  return Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2)}` : '—';
}

export function createRealPositionCard({
  contrato, mercadoId, nombre, tipoLabel, multiplier, limites,
}) {
  const div = document.createElement('div');
  div.className = 'position-card';
  div.id = `pos-${contrato.contract_id}`;
  div.innerHTML = `
    <div>
      <div class="pos-title"><span class="position-market-name">${nombre}</span> — ${tipoLabel} (x${multiplier})</div>
      <div class="pos-sub">Stake: $${parseFloat(contrato.buy_price || 0).toFixed(2)} | Spot: <span class="pos-spot">—</span> | ID: ${contrato.contract_id}</div>
      <div class="pos-limits">
        <span>Stop Loss <b class="pos-sl-amount">${dineroLimite(limites.stopLossAmount)}</b></span>
        <span>Take Profit <b class="pos-tp-amount">${dineroLimite(limites.takeProfitAmount)}</b></span>
      </div>
    </div>
    <div class="pos-pnl-box">
      <div class="pos-pnl" style="color:var(--text-faint)">$0.00</div>
      <div class="pos-status">Cargando...</div>
    </div>
    <div class="position-actions">
      <button class="btn-history position-chart-button" onclick="verGraficoPosicion('${mercadoId}', '${nombre}')">Ver gráfico en vivo</button>
      <button class="btn-close" onclick="cerrarPosicion(${contrato.contract_id})">Cerrar operación</button>
    </div>
  `;
  return div;
}

export function createSimulatedPositionCard(posicion, objetivos) {
  const div = document.createElement('div');
  div.className = 'position-card';
  div.id = `pos-${posicion.id}`;
  const tipoLabel = posicion.tipo === 'BUY' ? '🟢 BUY' : '🔴 SELL';
  const pnl = Number(posicion.pnl) || 0;
  div.innerHTML = `
    <div>
      <div class="pos-title">${posicion.nombre} — ${tipoLabel} (Simulación)</div>
      <div class="pos-sub">Stake: $${Number(posicion.stake).toFixed(2)} | Spot: <span class="pos-spot">${Number(posicion.precioActual).toFixed(3)}</span> | ${posicion.origen === 'automatica' ? 'Automática' : 'Manual'}</div>
      <div class="pos-limits">
        <span>Stop Loss <b class="pos-sl-amount">${dineroLimite(objetivos.riesgo)}</b></span>
        <span>Take Profit <b class="pos-tp-amount">${dineroLimite(objetivos.objetivo)}</b></span>
      </div>
    </div>
    <div class="pos-pnl-box">
      <div class="pos-pnl" style="color:${pnl >= 0 ? '#26a69a' : '#ef5350'}">${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)}</div>
      <div class="pos-status">Abierto</div>
    </div>
    <div class="position-actions">
      <button class="btn-history" onclick="verGraficoPosicion('${posicion.mercadoId}', '${posicion.nombre}')">Ver gráfico en vivo</button>
      <button class="btn-close" onclick="cerrarPosicionSimulada('${posicion.id}')">Cerrar operación</button>
    </div>
  `;
  return div;
}
