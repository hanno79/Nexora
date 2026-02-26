import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { storage } from './storage';
import { authenticateWebSocketRequest } from './wsAuth';
import { canViewWithPermission } from './sharePermissions';

interface WsClient {
  ws: WebSocket;
  userId: string;
  subscribedPrdIds: Set<string>;
  isAlive: boolean;
}

const clients = new Set<WsClient>();

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws: WebSocket, req) => {
    const userId = await authenticateWebSocketRequest(req);
    if (!userId) {
      ws.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'WebSocket authentication required' }));
      ws.close(1008, 'Unauthorized');
      return;
    }

    const client: WsClient = { ws, userId, subscribedPrdIds: new Set(), isAlive: true };
    clients.add(client);

    ws.on('pong', () => {
      client.isAlive = true;
    });

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        const normalizedPrdId = typeof msg.prdId === 'string' ? msg.prdId.trim() : '';

        if (msg.type === 'subscribe') {
          if (!normalizedPrdId) {
            ws.send(JSON.stringify({ type: 'error', code: 'INVALID_PRD_ID', message: 'prdId must be a non-empty string' }));
            return;
          }

          const prd = await storage.getPrd(normalizedPrdId);
          if (!prd) {
            ws.send(JSON.stringify({ type: 'error', code: 'PRD_NOT_FOUND', prdId: normalizedPrdId }));
            return;
          }

          if (prd.userId === client.userId) {
            client.subscribedPrdIds.add(normalizedPrdId);
            ws.send(JSON.stringify({ type: 'subscribed', prdId: normalizedPrdId }));
            return;
          }

          const shares = await storage.getPrdShares(normalizedPrdId);
          const canView = shares.some(
            (share) => share.sharedWith === client.userId && canViewWithPermission(share.permission),
          );
          if (!canView) {
            ws.send(JSON.stringify({ type: 'error', code: 'FORBIDDEN', prdId: normalizedPrdId }));
            return;
          }

          client.subscribedPrdIds.add(normalizedPrdId);
          ws.send(JSON.stringify({ type: 'subscribed', prdId: normalizedPrdId }));
        }

        if (msg.type === 'unsubscribe' && normalizedPrdId) {
          client.subscribedPrdIds.delete(normalizedPrdId);
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

  // Heartbeat: detect and remove stale clients every 30s
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.isAlive) {
        clients.delete(client);
        client.ws.terminate();
        continue;
      }
      client.isAlive = false;
      try {
        client.ws.ping();
      } catch {
        clients.delete(client);
        client.ws.terminate();
      }
    }
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeat);
  });
}

export function broadcastPrdUpdate(prdId: string | number, event: string, payload?: Record<string, unknown>) {
  const id = String(prdId);
  const msg = JSON.stringify({ type: event, prdId: id, data: payload, timestamp: Date.now() });
  for (const client of clients) {
    if (client.subscribedPrdIds.has(id) && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(msg);
      } catch {
        clients.delete(client);
      }
    }
  }
}
