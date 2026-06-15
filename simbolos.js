require('dotenv').config();

const TOKEN = process.env.DERIV_TOKEN;
const APP_ID = process.env.DERIV_APP_ID;
const ACCOUNT_ID = 'DOT93286548';

async function obtenerSimbolos() {
  const otpResponse = await fetch(
    `https://api.derivws.com/trading/v1/options/accounts/${ACCOUNT_ID}/otp`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Deriv-App-ID': APP_ID
      }
    }
  );

  const otpData = await otpResponse.json();
  const WebSocket = require('ws');
  const ws = new WebSocket(otpData.data.url);

  ws.on('open', () => {
    ws.send(JSON.stringify({ active_symbols: 'full' }));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.active_symbols) {
      console.log('\nTodos los símbolos disponibles:\n');
      console.log('Símbolo               | Nombre');
      console.log('----------------------|---------------------------');
      msg.active_symbols.forEach(s => {
        console.log(`${(s.underlying_symbol || s.symbol || '').padEnd(22)}| ${s.underlying_symbol_name || s.display_name || ''}`);
      });
      console.log(`\nTotal: ${msg.active_symbols.length} símbolos`);
    }
    if (msg.error) console.log('Error:', msg.error.message);
    ws.close();
  });

  ws.on('error', (err) => console.log('Error:', err.message));
}

obtenerSimbolos().catch(console.error);
