import { obtenerWsUrl, obtenerCuenta } from '../services/derivApi.js';
import { crearWebSocket, enviarProposal, comprarProposal } from '../services/websocketService.js';
import { MULTIPLICADOR_DEFAULT, FRACCION_RIESGO_STAKE } from '../config.js';
import { calcularObjetivosMonetarios } from './riskManager.js';

// Con P&L lineal del multiplicador (pnl = stake * mult * Δprecio / entrada),
// este multiplicador hace que el stop monetario (25% del stake) se alcance
// exactamente en la distancia entrada→sl de la señal (2σ), y el take profit
// (1.5x) en 3σ.
export function calcularMultiplicadorObjetivo({ entrada, sl }) {
  const entradaNumero = Number(entrada);
  const distancia = Math.abs(entradaNumero - Number(sl));
  if (!Number.isFinite(entradaNumero) || entradaNumero <= 0 || !Number.isFinite(distancia) || distancia <= 0) {
    return MULTIPLICADOR_DEFAULT;
  }
  const objetivo = (FRACCION_RIESGO_STAKE * entradaNumero) / distancia;
  if (!Number.isFinite(objetivo) || objetivo <= 0) return MULTIPLICADOR_DEFAULT;
  return Math.max(1, Math.round(objetivo));
}

export function elegirMultiplicadorPermitido(permitidos, objetivo) {
  if (!Array.isArray(permitidos) || !permitidos.length) return null;
  return permitidos.reduce((mejor, valor) => (
    Math.abs(valor - objetivo) < Math.abs(mejor - objetivo) ? valor : mejor
  ));
}

function multiplicadoresPermitidos(error) {
  const raw = error?.code_args?.[0];
  if (typeof raw !== 'string') return [];
  return raw.split(',').map(Number).filter(Number.isFinite);
}

function numeroFinito(value) {
  const numero = Number(value);
  return Number.isFinite(numero) ? numero : null;
}

function redondearMonto(value) {
  const numero = Number(value);
  if (!Number.isFinite(numero)) return 0;
  return Math.round((numero + Number.EPSILON) * 100) / 100;
}

export function extraerCostosReportados(data = {}) {
  const campos = ['commission', 'fee', 'contract_fee', 'transaction_fee'];
  const valores = campos
    .map(campo => numeroFinito(data[campo]))
    .filter(valor => valor !== null);

  if (Array.isArray(data.charges)) {
    data.charges.forEach(cargo => {
      const valor = numeroFinito(cargo?.amount ?? cargo?.value);
      if (valor !== null) valores.push(valor);
    });
  }

  return valores.length
    ? valores.reduce((total, valor) => total + Math.abs(valor), 0)
    : null;
}

export function normalizarCotizacion(propuesta, multiplicador) {
  return {
    proposalId: propuesta.id,
    precioCotizado: numeroFinito(propuesta.ask_price),
    payout: numeroFinito(propuesta.payout),
    spot: numeroFinito(propuesta.spot),
    multiplicador: numeroFinito(propuesta.multiplier) ?? numeroFinito(multiplicador),
    costosReportados: extraerCostosReportados(propuesta),
  };
}

export function crearPayload({
  mercadoId, contractType, stake, entrada, sl, tp, multiplicador, limitesMinimos = {}, currency = 'USD',
}) {
  const stakeRedondeado = redondearMonto(stake);
  const { riesgo: riesgoMonetario, objetivo: objetivoMonetario } = calcularObjetivosMonetarios(stakeRedondeado);
  const stopLossMinimo = redondearMonto(limitesMinimos.stop_loss || 0.1);
  const takeProfitMinimo = redondearMonto(limitesMinimos.take_profit || 0.1);
  return {
    amount: stakeRedondeado,
    basis: 'stake',
    contract_type: contractType,
    currency,
    multiplier: multiplicador,
    underlying_symbol: mercadoId,
    limit_order: {
      stop_loss: Math.max(stopLossMinimo, redondearMonto(riesgoMonetario)),
      take_profit: Math.max(takeProfitMinimo, redondearMonto(objetivoMonetario)),
    },
  };
}

async function procesarOrden({
  mercadoId,
  tipo,
  stake,
  entrada,
  sl,
  tp,
  accountMode = 'demo',
}, comprar, { confirmarCotizacion } = {}) {
  const [wsUrl, cuenta] = await Promise.all([
    obtenerWsUrl(accountMode),
    obtenerCuenta(accountMode),
  ]);
  const currency = cuenta?.currency || 'USD';
  const contractType = tipo === 'BUY' ? 'MULTUP' : 'MULTDOWN';

  const multiplicadorObjetivo = calcularMultiplicadorObjetivo({ entrada, sl });

  return new Promise((resolve, reject) => {
    let multiplicador = multiplicadorObjetivo;
    let reintentoMultiplicador = false;
    let cotizacion = null;
    let compraSolicitada = false;
    const limitesMinimos = {};
    const limitesReintentados = new Set();

    function solicitarProposal(socket) {
      enviarProposal(socket, crearPayload({
        mercadoId, contractType, stake, entrada, sl, tp, multiplicador, limitesMinimos, currency,
      }));
    }

    const ws = crearWebSocket(wsUrl, {
      onOpen: solicitarProposal,
      onMessage: msg => {
        if (msg.error) {
          const permitidos = multiplicadoresPermitidos(msg.error);
          if (msg.error.subcode === 'MultiplierOutOfRange' && permitidos.length && !reintentoMultiplicador) {
            reintentoMultiplicador = true;
            multiplicador = elegirMultiplicadorPermitido(permitidos, multiplicadorObjetivo) ?? permitidos[0];
            solicitarProposal(ws);
            return;
          }

          const field = msg.error.details?.field;
          const minimo = Number(msg.error.code_args?.[0]);
          if (
            msg.error.subcode === 'LimitOrderAmountTooLow'
            && ['stop_loss', 'take_profit'].includes(field)
            && Number.isFinite(minimo)
            && !limitesReintentados.has(field)
          ) {
            limitesReintentados.add(field);
            limitesMinimos[field] = minimo;
            solicitarProposal(ws);
            return;
          }
          ws.close();
          reject(new Error(msg.error.message));
          return;
        }

        if (msg.msg_type === 'proposal' && msg.proposal) {
          if (compraSolicitada) return;
          cotizacion = normalizarCotizacion(msg.proposal, multiplicador);
          if (comprar) {
            if (confirmarCotizacion && !confirmarCotizacion(cotizacion)) {
              ws.close();
              resolve({ cancelada: true, cotizacion, multiplicador });
              return;
            }
            compraSolicitada = true;
            comprarProposal(ws, msg.proposal.id, Number(msg.proposal.ask_price));
            return;
          }
          ws.close();
          resolve({ propuesta: msg.proposal, cotizacion, multiplicador });
        }

        if (msg.msg_type === 'buy') {
          ws.close();
          resolve({ compra: msg.buy, cotizacion, multiplicador });
        }
      },
      onError: () => {
        ws.close();
        reject(new Error('Error de conexión con Deriv'));
      },
    });
  });
}

export function cotizarOrdenDemo(parametros) {
  return procesarOrden(parametros, false);
}

export async function ejecutarOrdenDemo(parametros, opciones) {
  return procesarOrden(parametros, true, opciones);
}
