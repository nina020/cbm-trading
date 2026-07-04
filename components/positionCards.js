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

export function obtenerTimestampContrato(contrato = {}, campos = []) {
  for (const campo of campos) {
    const valor = contrato[campo];
    const numero = Number(valor);
    if (Number.isFinite(numero) && numero > 0) {
      return numero > 100000000000 ? Math.floor(numero / 1000) : Math.floor(numero);
    }
  }
  return null;
}

function dineroLimite(value) {
  return Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2)}` : '—';
}

export function createRealPositionCard({
  contrato, mercadoId, nombre, tipoLabel, multiplier, limites,
}) {
  const abiertaEn = obtenerTimestampContrato(contrato, [
    'purchase_time', 'date_start', 'start_time', 'transaction_time',
  ]);
  const cierraEn = obtenerTimestampContrato(contrato, [
    'date_expiry', 'expiry_time', 'sell_time',
  ]);
  const div = document.createElement('div');
  div.className = 'position-card';
  div.id = `pos-${contrato.contract_id}`;
  if (abiertaEn) div.dataset.openTime = String(abiertaEn);
  if (cierraEn) div.dataset.expiryTime = String(cierraEn);
  div.innerHTML = `
    <div>
      <div class="pos-title"><span class="position-market-name">${nombre}</span> — ${tipoLabel} (x${multiplier})</div>
      <div class="pos-sub">Stake: $${parseFloat(contrato.buy_price || 0).toFixed(2)} | Spot: <span class="pos-spot">—</span> | ID: ${contrato.contract_id}</div>
      <div class="pos-limits">
        <span>Stop Loss <b class="pos-sl-amount">${dineroLimite(limites.stopLossAmount)}</b></span>
        <span>Take Profit <b class="pos-tp-amount">${dineroLimite(limites.takeProfitAmount)}</b></span>
      </div>
      <div class="pos-timers">
        <span>Abierta hace <b class="pos-open-elapsed">—</b></span>
        <span>Cierre Deriv <b class="pos-expiry-countdown">Sin vencimiento fijo</b></span>
        <span>Revisión cargos <b class="pos-fee-review">—</b></span>
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

