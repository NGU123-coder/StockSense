import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { verifyAccessToken } from '../middleware/auth';

let io: Server | null = null;

/** Real-time channel. Clients authenticate with the same JWT used for the REST API. */
export function initSocket(server: HttpServer) {
  io = new Server(server, { cors: { origin: env.CLIENT_ORIGIN.split(','), credentials: true } });
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('unauthorized'));
      socket.data.user = verifyAccessToken(token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });
  io.on('connection', (socket) => {
    socket.join('all');
  });
  return io;
}

export type ServerEvent =
  'stock:changed' | 'alert:new' | 'alert:resolved' | 'po:changed' | 'forecast:completed' | 'forecast:updated';

export function emit(event: ServerEvent, payload: unknown) {
  io?.to('all').emit(event, payload);
}
