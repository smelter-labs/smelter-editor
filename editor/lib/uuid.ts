const HEX_LOOKUP = Array.from({ length: 256 }, (_, index) =>
  index.toString(16).padStart(2, '0'),
);

function createUuidFromRandomBytes(bytes: Uint8Array): string {
  // RFC 4122 version 4 bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return (
    HEX_LOOKUP[bytes[0]] +
    HEX_LOOKUP[bytes[1]] +
    HEX_LOOKUP[bytes[2]] +
    HEX_LOOKUP[bytes[3]] +
    '-' +
    HEX_LOOKUP[bytes[4]] +
    HEX_LOOKUP[bytes[5]] +
    '-' +
    HEX_LOOKUP[bytes[6]] +
    HEX_LOOKUP[bytes[7]] +
    '-' +
    HEX_LOOKUP[bytes[8]] +
    HEX_LOOKUP[bytes[9]] +
    '-' +
    HEX_LOOKUP[bytes[10]] +
    HEX_LOOKUP[bytes[11]] +
    HEX_LOOKUP[bytes[12]] +
    HEX_LOOKUP[bytes[13]] +
    HEX_LOOKUP[bytes[14]] +
    HEX_LOOKUP[bytes[15]]
  );
}

export function createUuid(): string {
  const cryptoApi = globalThis.crypto;

  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return createUuidFromRandomBytes(bytes);
  }

  return `fallback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
