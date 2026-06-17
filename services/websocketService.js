export function crearWebSocket(url, handlers = {}) {
  const ws = new WebSocket(url);
  ws.onopen = event => handlers.onOpen?.(ws, event);
  ws.onmessage = event => {
    try {
      handlers.onMessage?.(JSON.parse(event.data), ws, event);
    } catch (error) {
      handlers.onError?.(error, ws);
    }
  };
  ws.onerror = event => handlers.onError?.(event, ws);
  ws.onclose = event => handlers.onClose?.(event, ws);
  return ws;
}

export function suscribirTicks(ws, simbolo) {
  ws.send(JSON.stringify({ ticks: simbolo, subscribe: 1 }));
}

export function solicitarPortfolio(ws) {
  ws.send(JSON.stringify({ portfolio: 1 }));
}

export function suscribirContrato(ws, contractId) {
  ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 }));
}

export function solicitarContratoEstado(ws, contractId) {
  ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: contractId }));
}

export function cerrarContrato(ws, contractId) {
  ws.send(JSON.stringify({ sell: contractId, price: 0 }));
}

export function enviarProposal(ws, payload) {
  ws.send(JSON.stringify({ proposal: 1, ...payload }));
}

export function comprarProposal(ws, proposalId, price) {
  ws.send(JSON.stringify({ buy: proposalId, price }));
}
