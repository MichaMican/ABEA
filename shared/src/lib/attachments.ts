/**
 * Encrypted attachments as defined in the Matrix spec (“Sending encrypted attachments”):
 * AES-CTR-256 with a random key, 64-bit counter, SHA-256 of the ciphertext.
 */
export interface EncryptedFile {
  url: string;
  key: { kty: "oct"; key_ops: string[]; alg: "A256CTR"; k: string; ext: true };
  iv: string;
  hashes: { sha256: string };
  v: "v2";
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=+$/, "");
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function encryptAttachment(
  data: ArrayBuffer,
): Promise<{ data: ArrayBuffer; info: Omit<EncryptedFile, "url"> }> {
  const iv = new Uint8Array(16);
  crypto.getRandomValues(iv.subarray(0, 8));
  const key = await crypto.subtle.generateKey({ name: "AES-CTR", length: 256 }, true, ["encrypt", "decrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-CTR", counter: iv, length: 64 }, key, data);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const digest = await crypto.subtle.digest("SHA-256", ciphertext);
  return {
    data: ciphertext,
    info: {
      key: { kty: "oct", key_ops: ["encrypt", "decrypt"], alg: "A256CTR", k: jwk.k!, ext: true },
      iv: toBase64(iv),
      hashes: { sha256: toBase64(new Uint8Array(digest)) },
      v: "v2",
    },
  };
}

export async function decryptAttachment(data: ArrayBuffer, info: Omit<EncryptedFile, "url">): Promise<ArrayBuffer> {
  if (info.hashes?.sha256) {
    const digest = toBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));
    if (digest !== info.hashes.sha256.replace(/=+$/, "")) throw new Error("Attachment hash mismatch");
  }
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "oct", k: info.key.k, alg: "A256CTR", ext: true, key_ops: ["encrypt", "decrypt"] },
    { name: "AES-CTR" },
    false,
    ["decrypt"],
  );
  return crypto.subtle.decrypt({ name: "AES-CTR", counter: fromBase64(info.iv), length: 64 }, key, data);
}
