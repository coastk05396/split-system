/**
 * A random, time-sortable ID (UUIDv7 layout, decision 15): 48 bits of milliseconds, then
 * random bits. Lists that page "ordered by ID" (decision 16) read newest first by it.
 */
export function newSortableId(now: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let time = BigInt(now);
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = Number(time & 0xffn);
    time >>= 8n;
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
