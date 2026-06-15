require('dotenv').config();

const TOKEN = process.env.DERIV_TOKEN;
const APP_ID = process.env.DERIV_APP_ID;
const ACCOUNT_ID = 'DOT93286548';
const CONTRACT_ID = process.argv[2];

if (!CONTRACT_ID) {
  console.log('Uso: node sell_test.js <contract_id>');
  process.exit(1);
}

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
  if (!wsUrl) { console.log('Error de autenticación'); return; }

  const WebSocket = require('ws');
  const ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log(`Cerrando contrato ${CONTRACT_ID}...\n`);
    ws.send(JSON.stringify({ sell: parseInt(CONTRACT_ID), price: 0 }));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    console.log(JSON.stringify(msg, null, 2));
    ws.close();
    process.exit(0);
  });

  ws.on('error', (err) => console.log('Error WS:', err.message));
}

main().catch(console.error);
