import { gunzipSync, gzipSync } from 'fflate';

export function isGzip(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
}

export function decompress(data: Uint8Array): Uint8Array {
  try {
    return gunzipSync(data);
  } catch {
    throw new Error('Failed to decompress gzip data');
  }
}

export function decompressToString(data: Uint8Array): string {
  return new TextDecoder('utf-8').decode(decompress(data));
}

/** Match C15 `g_zlib_compressor_new(..., 6)` in FileOutStream.cpp */
export function compress(data: Uint8Array): Uint8Array {
  return gzipSync(data, { level: 6 });
}

export function compressString(text: string): Uint8Array {
  return compress(new TextEncoder().encode(text));
}