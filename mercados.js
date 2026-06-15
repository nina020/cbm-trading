const WebSocket = require('ws');

const ws = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089');

ws.on('open', () => {
  console.log('Obteniendo mercados disponibles...\n');
  ws.send(JSON.stringify({ active_symbols: 'brief', product_type: 'basic' }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.active_symbols) {
    const sinteticos = msg.active_symbols.filter(s =>
      s.display_name.includes('Boom') ||
      s.display_name.includes('Crash') ||
      s.display_name.includes('Step') ||
      s.display_name.includes('Volatility')
    );
    console.log('Símbolo API           | Nombre');
    console.log('----------------------|---------------------------');
    sinteticos.forEach(s => {
      console.log(`${s.symbol.padEnd(22)}| ${s.display_name}`);
    });
    ws.close();
  }
});

ws.on('error', (err) => console.log('Error:', err.message));
