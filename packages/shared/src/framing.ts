/**
 * Chrome Native Messaging framing.
 *
 * Each message on the wire is a 4-byte length prefix (the JSON byte length, in the
 * host's native byte order — little-endian on all platforms we target) followed by
 * the UTF-8 JSON body.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Encode a value as a single length-prefixed native-messaging frame. */
export function encodeMessage(message: unknown): Uint8Array {
  const body = encoder.encode(JSON.stringify(message));
  const frame = new Uint8Array(4 + body.length);
  new DataView(frame.buffer).setUint32(0, body.length, true);
  frame.set(body, 4);
  return frame;
}

/**
 * Accumulates incoming bytes and yields whole messages as soon as each frame is
 * complete. Handles chunk boundaries that split a length prefix or a body.
 */
export class FrameDecoder {
  private buffer = new Uint8Array(0);

  /** Append a chunk and return every complete message it completed. */
  push(chunk: Uint8Array): unknown[] {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    const messages: unknown[] = [];
    while (this.buffer.length >= 4) {
      const length = new DataView(
        this.buffer.buffer,
        this.buffer.byteOffset,
        4,
      ).getUint32(0, true);
      if (this.buffer.length < 4 + length) break;
      const body = this.buffer.subarray(4, 4 + length);
      messages.push(JSON.parse(decoder.decode(body)));
      this.buffer = this.buffer.subarray(4 + length);
    }
    return messages;
  }
}
