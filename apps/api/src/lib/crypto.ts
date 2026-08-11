// Chiffrement symétrique (AES-GCM) pour les secrets stockés en base (ex. clé API
// Anthropic). La clé de chiffrement est dérivée de SESSION_SECRET — pas de secret
// supplémentaire à gérer. Format stocké : base64(iv[12] || ciphertext).

async function deriveKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plaintext: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const bytes = new Uint8Array(iv.length + ct.byteLength);
  bytes.set(iv, 0);
  bytes.set(new Uint8Array(ct), iv.length);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function decryptSecret(payload: string, secret: string): Promise<string | null> {
  try {
    const bin = atob(payload);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    const iv = bytes.slice(0, 12);
    const ct = bytes.slice(12);
    const key = await deriveKey(secret);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
