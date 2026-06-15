require('dotenv').config();

const TOKEN = process.env.DERIV_TOKEN;
const APP_ID = process.env.DERIV_APP_ID;
const ACCOUNT_ID = 'DOT93286548';
const PERIODO = 14;

const MERCADOS = {
  '1':  { simbolo: 'BOOM500',   nombre: 'Boom 500',    perfil: '🔥 Alta'        },
  '2':  { simbolo: 'BOOM600',   nombre: 'Boom 600',    perfil: '⚡ Media-alta'  },
  '3':  { simbolo: 'BOOM900',   nombre: 'Boom 900',    perfil: '📊 Media'       },
  '4':  { simbolo: 'BOOM1000',  nombre: 'Boom 1000',   perfil: '✅ Estable'     },
  '5':  { simbolo: 'CRASH500',  nombre: 'Crash 500',   perfil: '🔥 Alta'        },
  '6':  { simbolo: 'CRASH600',  nombre: 'Crash 600',   perfil: '⚡ Media-alta'  },
  '7':  { simbolo: 'CRASH900',  nombre: 'Crash 900',   perfil: '📊 Media'       },
  '8':  { simbolo: 'CRASH1000', nombre: 'Crash 1000',  perfil: '✅ Estable'     },
  '9':  { simbolo: 'stpRNG',    nombre: 'Step 100',    perfil: '✅ Muy estable' },
  '10': { simbolo: 'stpRNG2',   nombre: 'Step 200',    perfil: '✅ Muy estable' },
  '11': { simbolo: 'stpRNG3',   nombre: 'Step 300',    perfil: '✅ Muy estable' },
  '12': { simbolo: 'stpRNG4',   nombre: 'Step 400',    perfil: '✅ Muy estable' },
  '13': { simbolo: 'stpRNG5',   nombre: 'Step 500',    perfil: '✅ Muy estable' },
  '14': { simbolo: '1HZ10V',    nombre: 'Vol 10 (1s)', perfil: '✅ Muy estable' },
  '15': { simbolo: 'R_10',      nombre: 'Vol 10',      perfil: '✅ Muy estable' },
  '16': { simbolo: '1HZ25V',    nombre: 'Vol 25 (1s)', perfil: '✅ Estable'     },
  '17': { simbolo: 'R_25',      nombre: 'Vol 25',      perfil: '✅ Estable'     },
  '18': { simbolo: '1HZ50V',    nombre: 'Vol 50 (1s)', perfil: '📊 Media'       },
  '19': { simbolo: 'R_50',      nombre: 'Vol 50',      perfil: '📊 Media'       },
  '20': { simbolo: '1HZ75V',    nombre: 'Vol 75 (1s)', perfil: '⚡ Media-alta'  },
  '21': { simbolo: 'R_75',      nombre: 'Vol 75',      perfil: '⚡ Media-alta'  },
  '22': { simbolo: '1HZ100V',   nombre: 'Vol 100(1s)', perfil: '🔥 Alta'        },
  '23': { simbolo: 'R_100',     nombre: 'Vol 100',     perfil: '🔥 Alta'        },
};

const conexionesActivas = {};

function calcularMA(arr) {
  return (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(4);
}

function calcularRSI(arr) {
  let ganancias = 0, perdidas = 0;
  for (let i = 1; i < arr.length; i++) {
    const diff = arr[i] - arr[i - 1];
    if (diff >= 0) ganancias += diff;
    else perdidas += Math.abs(diff);
  }
  const rs = ganancias / (perdidas || 1);
  return (100 - 100 / (1 + rs)).toFixed(2);
}

function senal(precio, ma, rsi) {
  if (precio > ma && rsi < 70) return '🟢 BUY  ▲';
  if (precio < ma && rsi > 30) return '🔴 SELL ▼';
  return '🟡 ESPERAR —';
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

async function agregarMercado(opcion) {
  const mercado = MERCADOS[opcion];
  if (!mercado) { console.log(`\n⚠️  Opción ${opcion} no válida.\n`); return; }
  if (conexionesActivas[opcion]) { console.log(`\n⚠️  ${mercado.nombre} ya está activo.\n`); return; }

  const wsUrl = await obtenerWsUrl();
  if (!wsUrl) { console.log('\n❌ Error obteniendo URL de autenticación.\n'); return; }

  const WebSocket = require('ws');
  const precios = [];
  const ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log(`\n✅ Agregado: ${mercado.nombre} (${mercado.perfil})\n`);
    ws.send(JSON.stringify({ ticks: mercado.simbolo, subscribe: 1 }));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.error) { console.log(`[${mercado.nombre}] Error: ${msg.error.message}`); return; }
    if (msg.tick) {
      const precio = msg.tick.quote;
      const hora = new Date(msg.tick.epoch * 1000).toLocaleTimeString();
      precios.push(precio);
      if (precios.length < PERIODO) return;
      if (precios.length > PERIODO) precios.shift();
      const ma = calcularMA(precios);
      const rsi = calcularRSI(precios);
      const rec = senal(precio, parseFloat(ma), parseFloat(rsi));
      console.log(`[${hora}] ${mercado.nombre.padEnd(12)} | ${String(precio).padEnd(12)} | RSI: ${rsi.padEnd(6)} | ${rec}`);
    }
  });

  ws.on('error', (err) => console.log(`[${mercado.nombre}] Error: ${err.message}`));
  ws.on('close', () => {
    if (conexionesActivas[opcion]) {
      delete conexionesActivas[opcion];
      console.log(`\n🔴 Desconectado: ${mercado.nombre}\n`);
    }
  });

  conexionesActivas[opcion] = { ws, mercado };
}

function quitarMercado(opcion) {
  const conexion = conexionesActivas[opcion];
  if (!conexion) { console.log(`\n⚠️  El mercado ${opcion} no está activo.\n`); return; }
  conexion.ws.close();
  delete conexionesActivas[opcion];
}

function mostrarMenu() {
  console.log('\n==============================');
  console.log('   HERRAMIENTA DE TRADING CBM');
  console.log('==============================');
  console.log('\n✅ Muy estable  📊 Media  ⚡ Media-alta  🔥 Alta\n');
  console.log('--- BOOM ---');
  ['1','2','3','4'].forEach(k => { const m = MERCADOS[k]; console.log(`  ${k.padStart(2)}. ${m.nombre.padEnd(15)} ${m.perfil}`); });
  console.log('\n--- CRASH ---');
  ['5','6','7','8'].forEach(k => { const m = MERCADOS[k]; console.log(`  ${k.padStart(2)}. ${m.nombre.padEnd(15)} ${m.perfil}`); });
  console.log('\n--- STEP INDEX ---');
  ['9','10','11','12','13'].forEach(k => { const m = MERCADOS[k]; console.log(`  ${k.padStart(2)}. ${m.nombre.padEnd(15)} ${m.perfil}`); });
  console.log('\n--- VOLATILITY ---');
  ['14','15','16','17','18','19','20','21','22','23'].forEach(k => { const m = MERCADOS[k]; console.log(`  ${k.padStart(2)}. ${m.nombre.padEnd(15)} ${m.perfil}`); });
  console.log('\n--- COMANDOS ---');
  console.log('  +N  → Agregar mercado    (ej: +3)');
  console.log('  -N  → Quitar mercado     (ej: -3)');
  console.log('  ?   → Ver activos ahora');
  console.log('  m   → Ver este menú');
  console.log('  q   → Salir\n');
}

function escucharComandos() {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (input) => {
    const cmd = input.toString().trim();
    if (cmd === 'q') { Object.values(conexionesActivas).forEach(c => c.ws.close()); process.exit(0); }
    if (cmd === '?') { console.log('\n📡 Activos:', Object.values(conexionesActivas).map(c => c.mercado.nombre).join(', ') || 'ninguno'); return; }
    if (cmd === 'm') { mostrarMenu(); return; }
    if (cmd.startsWith('+')) { await agregarMercado(cmd.slice(1)); return; }
    if (cmd.startsWith('-')) { quitarMercado(cmd.slice(1)); return; }
    console.log('\n⚠️  Comando no reconocido. Escribe m para ver el menú.\n');
  });
}

mostrarMenu();
console.log('Hora          | Mercado      | Precio       | RSI    | Señal');
console.log('--------------|--------------|--------------|--------|----------');
escucharComandos();
