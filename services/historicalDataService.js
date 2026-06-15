import { obtenerWsUrl } from './derivApi.js';
import { crearWebSocket } from './websocketService.js';

export async function obtenerTicksHistoricos(simbolo, count = 1000) {
  const wsUrl = await obtenerWsUrl();

  return new Promise((resolve, reject) => {
    let ticks = [];
    let restantes = count;

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('La consulta histórica excedió el tiempo de espera'));
    }, 30000);

    function solicitarBloque(socket, end = 'latest') {
      socket.send(JSON.stringify({
        ticks_history: simbolo,
        adjust_start_time: 1,
        count: Math.min(restantes, 1000),
        end,
        style: 'ticks',
      }));
    }

    const ws = crearWebSocket(wsUrl, {
      onOpen: socket => solicitarBloque(socket),
      onMessage: msg => {
        if (msg.error) {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(msg.error.message));
          return;
        }
        if (!msg.history) return;

        const precios = msg.history.prices || [];
        const tiempos = msg.history.times || [];
        const bloque = precios.map((precio, index) => ({
          precio: Number(precio),
          epoch: Number(tiempos[index]),
        }));

        ticks = [...bloque, ...ticks];
        restantes -= bloque.length;

        if (restantes <= 0 || bloque.length === 0) {
          clearTimeout(timeout);
          ws.close();
          resolve(ticks.slice(-count));
          return;
        }

        solicitarBloque(ws, bloque[0].epoch - 1);
      },
      onError: () => {
        clearTimeout(timeout);
        reject(new Error('No se pudieron obtener los datos históricos'));
      },
    });
  });
}
