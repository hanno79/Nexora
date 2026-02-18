import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

interface WsClient {
  ws: WebSocket;
  subscribedPrdIds: Set<string>;
}

const clients = new Set<WsClient>();

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    const client: WsClient = { ws, subscribedPrdIds: new Set() };
    clients.add(client);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'subscribe' && msg.prdId) {
          client.subscribedPrdIds.add(String(msg.prdId));
        }
        if (msg.type === 'unsubscribe' && msg.prdId) {
          client.subscribedPrdIds.delete(String(msg.prdId));
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      clients.delete(client);
    });

    ws.send(JSON.stringify({ type: 'connected' }));
  });
}

export function broadcastPrdUpdate(prdId: string | number, event: string, payload?: any) {
  const id = String(prdId);
  const msg = JSON.stringify({ type: event, prdId: id, data: payload, timestamp: Date.now() });
  for (const client of clients) {
    if (client.subscribedPrdIds.has(id) && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(msg);
    }
  }
}
