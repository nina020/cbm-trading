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
    console.log('Conectado. Enviando proposal de prueba...\n');

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

    console.log('Enviando:', JSON.stringify(propuesta, null, 2));
    ws.send(JSON.stringify(propuesta));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    console.log('\n=== Respuesta de Deriv ===');
    console.log(JSON.stringify(msg, null, 2));
    console.log('\n✅ Esto fue SOLO una cotización. No se ejecutó ninguna compra.');
    ws.close();
    process.exit(0);
  });

  ws.on('error', (err) => console.log('Error WS:', err.message));
  ws.on('close', () => console.log('\nConexión cerrada'));
}

main().catch(console.error);
