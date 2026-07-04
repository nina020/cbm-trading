function volatilidad(value) {
  return Number.isFinite(value) ? `${value.toFixed(3)}%` : '—';
}

function etiquetaNivel(nivel) {
  if (nivel === 'recomendable') return 'Más recomendable';
  if (nivel === 'considerar') return 'Considerar';
  if (nivel === 'observar') return 'Observar';
  return 'Recopilando datos';
}

function etiquetaEstrategia(estrategia) {
  if (!estrategia) return 'No evaluada';
  if (estrategia.permitido) return 'Disponible';
  if (estrategia.codigo === 'schedule') return 'Fuera de horario';
  if (estrategia.codigo === 'frequency') return 'Frecuencia limitada';
  return 'Pausada';
}

export function renderMarketRanking(contenedor, mercados) {
  if (!contenedor) return;
  if (!mercados.length) {
    contenedor.innerHTML = '<div class="positions-empty">Analizando mercados estables...</div>';
    return;
  }

  contenedor.innerHTML = mercados.slice(0, 3).map((mercado, index) => `
    <div class="market-rank-card market-rank-${mercado.nivel}">
      <div class="market-rank-position">${mercado.listo ? index + 1 : '—'}</div>
      <div class="market-rank-main">
        <strong>${mercado.nombre}</strong>
        <span>${etiquetaNivel(mercado.nivel)}</span>
      </div>
      <div class="market-rank-score">${mercado.puntuacion}/100</div>
      <div class="market-rank-details">
        <div class="market-rank-metric"><small>Estabilidad</small><b>${volatilidad(mercado.volatilidadRelativa)}</b></div>
        <div class="market-rank-metric"><small>Calidad</small><b>${mercado.calidad}/100</b></div>
        <div class="market-rank-metric"><small>Umbral</small><b>${mercado.umbralMinimo ? `${mercado.umbralMinimo}/100` : 'Global'}</b></div>
        <div class="market-rank-metric"><small>Historial</small><b>${mercado.historial.total ? `${mercado.historial.winRate.toFixed(0)}%` : 'Sin datos'}</b></div>
        <div class="market-rank-metric"><small>Operativa</small><b>${etiquetaEstrategia(mercado.estrategia)}</b></div>
      </div>
      <div class="market-rank-actions">
        <small>Recomendación ${index + 1}</small>
        <button class="btn-history market-rank-open" onclick="abrirMercadoRecomendado('${mercado.id}')">Abrir</button>
      </div>
    </div>
  `).join('');
}
