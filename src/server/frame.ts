// The submit body: version byte, big-endian u16 meta length, JSON meta, then the log's bytes unencoded. Base64 would cost a
// third more on the part that matters. No crypto or zod here, so the browser can import this to build a body.

export const FRAME_VERSION = 1;
const HEADER_BYTES = 3;

export interface SubmissionMeta {
  ticket: string;
  /** Signed stamps, or null when the fire-and-forget call failed. */
  start: string | null;
  end: string | null;
  device: 'keyboard' | 'touch';
  timeZone: string;
  /** The held run this one retypes, if any. */
  confirms: string | null;
}

export function encodeSubmission(meta: SubmissionMeta, log: Uint8Array): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(meta));
  const out = new Uint8Array(HEADER_BYTES + text.length + log.length);
  out[0] = FRAME_VERSION;
  new DataView(out.buffer).setUint16(1, text.length);
  out.set(text, HEADER_BYTES);
  out.set(log, HEADER_BYTES + text.length);
  return out;
}

export function splitSubmission(bytes: Uint8Array): { metaBytes: Uint8Array; log: Uint8Array } | null {
  if (bytes.length < HEADER_BYTES || bytes[0] !== FRAME_VERSION) return null;
  const metaLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(1);
  if (HEADER_BYTES + metaLength > bytes.length) return null;
  return {
    metaBytes: bytes.subarray(HEADER_BYTES, HEADER_BYTES + metaLength),
    log: bytes.subarray(HEADER_BYTES + metaLength),
  };
}
