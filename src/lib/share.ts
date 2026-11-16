import type { ISODate } from '../types';

/**
 * A plan that travels inside a link. Nothing is uploaded: the whole plan is
 * packed into the part of the URL after `#`, which browsers never send to a
 * server.
 */
export interface SharedPlan {
  name: string;
  date: ISODate;
  intention: string;
  tasks: { title: string; planned: number | null; done: boolean; channel: string | null; color: string | null; start: number | null }[];
}

const PREFIX = '#plan=';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // Bad input fails on both ends of the stream. The read below reports it,
  // so the write side is silenced to avoid an unhandled rejection.
  writer.write(bytes as BufferSource).catch(() => undefined);
  writer.close().catch(() => undefined);
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** Returns the hash part of a share link, starting with `#plan=`. */
export async function encodePlan(plan: SharedPlan): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(plan));
  if (typeof CompressionStream === 'undefined') return `${PREFIX}j.${toBase64Url(raw)}`;
  return `${PREFIX}z.${toBase64Url(await pipe(raw, new CompressionStream('deflate-raw')))}`;
}

export function isShareHash(hash: string): boolean {
  return hash.startsWith(PREFIX);
}

function isPlan(value: unknown): value is SharedPlan {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === 'string' &&
    typeof v.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(v.date) &&
    typeof v.intention === 'string' &&
    Array.isArray(v.tasks) &&
    v.tasks.every((t) => typeof t === 'object' && t !== null && typeof (t as { title?: unknown }).title === 'string')
  );
}

/** Reads a plan back out of a link. Returns null for anything malformed. */
export async function decodePlan(hash: string): Promise<SharedPlan | null> {
  if (!isShareHash(hash)) return null;
  try {
    const body = hash.slice(PREFIX.length);
    const kind = body.slice(0, 2);
    let bytes = fromBase64Url(body.slice(2));
    if (kind === 'z.') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    else if (kind !== 'j.') return null;
    const plan: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isPlan(plan) ? plan : null;
  } catch {
    return null;
  }
}
