import { getStore } from '@netlify/blobs';
import { createHash, randomUUID } from 'node:crypto';
import type { AdminActor } from './security';

export interface AuditEventInput {
  actor: AdminActor;
  action: string;
  target: string;
  commitSha?: string;
  metadata?: Record<string, unknown>;
}

export async function writeAuditEvent(input: AuditEventInput) {
  const store = getStore('admin-audit');
  const latest = await store.get('latest', { type: 'json' }).catch(() => null) as { hash?: string } | null;
  const event = {
    id: randomUUID(),
    actor: input.actor,
    action: input.action,
    target: input.target,
    commitSha: input.commitSha,
    timestamp: new Date().toISOString(),
    prevHash: latest?.hash ?? null,
    metadata: input.metadata ?? {},
  };
  const eventHash = createHash('sha256').update(JSON.stringify(event)).digest('hex');
  const sealed = { ...event, eventHash };

  await store.setJSON(`events/${event.timestamp}-${event.id}.json`, sealed);
  await store.setJSON('latest', { hash: eventHash, eventId: event.id, timestamp: event.timestamp });
  return sealed;
}

export async function listAuditEvents(limit = 50) {
  const store = getStore('admin-audit');
  const { blobs } = await store.list({ prefix: 'events/' });
  const keys = blobs.map(blob => blob.key).sort().slice(-limit).reverse();
  const events = await Promise.all(keys.map(key => store.get(key, { type: 'json' }).catch(() => null)));
  return events.filter(Boolean);
}
