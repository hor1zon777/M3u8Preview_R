import crypto from 'node:crypto';
import type { TokenPayload } from '@m3u8-preview/shared';

interface TicketEntry {
  userId: string;
  role: string;
  expiresAt: number;
}

const TICKET_TTL_MS = 30_000;
const MAX_TICKETS = 1000;

const store = new Map<string, TicketEntry>();

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) {
      store.delete(key);
    }
  }
}, 60_000);
cleanupTimer.unref();

export function createSseTicket(userId: string, role: string): string {
  if (store.size >= MAX_TICKETS) {
    const firstKey = store.keys().next().value;
    if (firstKey !== undefined) store.delete(firstKey);
  }
  const ticket = crypto.randomBytes(32).toString('hex');
  store.set(ticket, { userId, role, expiresAt: Date.now() + TICKET_TTL_MS });
  return ticket;
}

export function consumeSseTicket(ticket: string): TokenPayload | null {
  const entry = store.get(ticket);
  if (!entry) return null;
  store.delete(ticket);
  if (Date.now() > entry.expiresAt) return null;
  return { userId: entry.userId, role: entry.role } as TokenPayload;
}
