function hora(fecha) {
  return fecha ? new Date(fecha).toLocaleString() : '—';
}

function dinero(value, signo = false) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const numero = Number(value);
  const prefijo = signo && numero >= 0 ? '+' : numero < 0 ? '-' : '';
  return `${prefijo}$${Math.abs(numero).toFixed(2)}`;
}

function modoTexto(modo) {
  return modo === 'real' ? 'Real controlado' : 'Demo real';
}

function origenTexto(item) {
  if (item.tipoEjecucion === 'canasta_3x') return 'Canasta 3x';
  if (item.origen === 'automatica') return 'Automática';
  return 'Manual';
}

export function renderExecutionTable({ registros, tbody, empty, summary }) {
  const ganadas = registros.filter(item => item.estado === 'ganada').length;
  const perdidas = registros.filter(item => item.estado === 'perdida').length;
  const pendientes = registros.filter(item => item.estado === 'pendiente').length;

  if (summary) {
    summary.total.textContent = registros.length;
    summary.ganadas.textContent = ganadas;
    summary.perdidas.textContent = perdidas;
    summary.pendientes.textContent = pendientes;
  }

  if (!registros.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  tbody.innerHTML = registros.slice(0, 100).map(item => {
    const estado = item.estado === 'pendiente' ? 'Pendiente'
      : item.estado === 'ganada' ? 'Ganada' : 'Perdida';
    const pnlNeto = item.pnlNeto ?? item.pnl;
    const pnlBruto = item.pnlBruto ?? (item.costos === 0 ? pnlNeto : null);
    const color = pnlNeto === null || pnlNeto === undefined ? 'var(--text-faint)'
      : pnlNeto >= 0 ? '#26a69a' : '#ef5350';
    // Cambio #17: columnas de contexto de análisis (patrón, confirmaciones, tendencia, calidad).
    const patronTexto = item.patron || '—';
    const confirmacionesTexto = item.confirmaciones !== null && item.confirmaciones !== undefined
      ? `${item.confirmaciones}/4` : '—';
    const tendenciaTexto = item.tendencia || '—';
    const calidadTexto = item.calidad !== null && item.calidad !== undefined
      ? `${item.calidad}/100` : '—';
    const tendColor = item.tendencia === 'alcista' ? '#22c55e'
      : item.tendencia === 'bajista' ? '#ef4444' : 'var(--text-faint)';
    return `
      <tr>
        <td>${hora(item.abiertaEn)}</td>
        <td>${item.nombre}</td>
        <td><span class="tag ${item.tipo === 'BUY' ? 'tag-buy' : 'tag-sell'}">${item.tipo}</span></td>
        <td>${modoTexto(item.modo)}</td>
        <td>${origenTexto(item)}</td>
        <td>$${Number(item.stake).toFixed(2)}</td>
        <td>${item.multiplicador ? `x${item.multiplicador}` : '—'}</td>
        <td><span class="tag tag-${item.estado}">${estado}</span></td>
        <td>${dinero(pnlBruto, true)}</td>
        <td>${dinero(item.costos)}</td>
        <td style="color:${color};font-weight:600">${dinero(pnlNeto, true)}</td>
        <td style="font-size:10px" title="Patrón de vela al ejecutar">${patronTexto}</td>
        <td style="font-size:10px;text-align:center" title="Confirmaciones Billy Chacón (0-4)">${confirmacionesTexto}</td>
        <td style="font-size:10px;color:${tendColor}" title="Tendencia al ejecutar">${tendenciaTexto}</td>
        <td style="font-size:10px;text-align:center" title="Calidad de señal al ejecutar">${calidadTexto}</td>
      </tr>
    `;
  }).join('');
}
