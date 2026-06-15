require('dotenv').config();

const TOKEN = process.env.DERIV_TOKEN;
const APP_ID = process.env.DERIV_APP_ID;
const ACCOUNT_ID = 'DOT93286548';
const SIMBOLO = 'BOOM500';
const MULTIPLICADOR = 100;
const STAKE = 10;

async function obtenerWsUrl() {
  const res = await fetch(
    `https://api.derivws.com/trading/v1/options/accounts/${ACCOUNT_ID}/otp`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Deriv-App-ID': APP_ID
      }
    }
  );
  const data = await res.json();
  return data.data?.url || null;
}

async function main() {
  const wsUrl = await obtenerWsUrl();
  if (!wsUrl) {
    console.log('Error de autenticación');
    return;
  }

  const WebSocket = require('ws');
  const ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log('Conectado. Pidiendo cotización fresca...\n');

    const propuesta = {
      proposal: 1,
      amount: STAKE,
      basis: 'stake',
      contract_type: 'MULTUP',
      currency: 'USD',
      multiplier: MULTIPLICADOR,
      underlying_symbol: SIMBOLO,
      limit_order: {
        stop_loss: 2,
        take_profit: 3
      }
    };

    ws.send(JSON.stringify(propuesta));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);

    if (msg.msg_type === 'proposal' && msg.proposal) {
      console.log('Cotización recibida.');
      console.log('Precio actual (spot):', msg.proposal.spot);
      console.log('SL en precio:', msg.proposal.limit_order.stop_loss.value);
      console.log('TP en precio:', msg.proposal.limit_order.take_profit.value);
      console.log('\n>>> Enviando BUY (esto abre la posición) <<<\n');

      const compra = {
        buy: msg.proposal.id,
        price: STAKE
      };

      ws.send(JSON.stringify(compra));
      return;
    }

    if (msg.error) {
      console.log('=== Error ===');
      console.log(JSON.stringify(msg.error, null, 2));
      ws.close();
      process.exit(0);
    }

    if (msg.msg_type === 'buy') {
      console.log('=== ✅ POSICIÓN ABIERTA ===');
      console.log(JSON.stringify(msg.buy, null, 2));
      console.log('\n📌 Guarda el "contract_id" — lo necesitarás para revisar o cerrar la posición.');
      ws.close();
      process.exit(0);
    }
  });

  ws.on('error', (err) => console.log('Error WS:', err.message));
  ws.on('close', () => console.log('\nConexión cerrada'));
}

main().catch(console.error);
