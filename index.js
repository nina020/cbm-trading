const WebSocket = require('ws');

const ws = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089');

ws.on('open', () => {
  console.log('Conectado a Deriv (endpoint público)');
  ws.send(JSON.stringify({ ticks: 'R_75', subscribe: 1 }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.tick) {
    console.log('Precio:', msg.tick.quote, '| Símbolo:', msg.tick.symbol);
  } else {
    console.log('Mensaje:', msg);
  }
});

ws.on('error', (err) => console.log('Error:', err.message));
ws.on('close', () => console.log('Conexión cerrada'));
