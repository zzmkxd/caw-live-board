import * as nodeZlib from "zlib";

type ZlibWithZstd = typeof nodeZlib & {
  zstdDecompressSync?: (buf: Uint8Array | Buffer) => Buffer;
};

const zlib = nodeZlib as ZlibWithZstd;

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** Split concatenated zstd frames (dsh appends one frame per write). */
export function splitZstdFrames(buf: Buffer): Buffer[] {
  const starts: number[] = [];
  for (let i = 0; i <= buf.length - 4; i++) {
    if (
      buf[i] === MAGIC[0] &&
      buf[i + 1] === MAGIC[1] &&
      buf[i + 2] === MAGIC[2] &&
      buf[i + 3] === MAGIC[3]
    ) {
      starts.push(i);
    }
  }
  if (starts.length === 0) {
    return [buf];
  }
  const frames: Buffer[] = [];
  for (let k = 0; k < starts.length; k++) {
    const a = starts[k];
    const b = k + 1 < starts.length ? starts[k + 1] : buf.length;
    frames.push(buf.subarray(a, b));
  }
  return frames;
}

/** Decompress multi-frame zstd or return utf8 if already plain JSONL. */
export function decompressDshLog(buf: Buffer, maxFrames = Infinity): string {
  if (buf.length >= 4 && buf.subarray(0, 4).equals(MAGIC)) {
    const inflate = zlib.zstdDecompressSync;
    if (typeof inflate !== "function") {
      throw new Error("zlib.zstdDecompressSync unavailable (need Node 22+)");
    }
    const frames = splitZstdFrames(buf);
    let out = "";
    const n = Math.min(frames.length, maxFrames);
    for (let i = 0; i < n; i++) {
      try {
        out += inflate(frames[i]).toString("utf8");
      } catch {
        /* skip corrupt frame */
      }
    }
    return out;
  }
  return buf.toString("utf8");
}
