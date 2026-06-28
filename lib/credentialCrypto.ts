import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export type EncryptedBlob = {
  ciphertext: string;
  iv: string;
  tag: string;
};

function encryptionKey(): Buffer {
  const raw = process.env.ALPACA_CREDENTIALS_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      'ALPACA_CREDENTIALS_ENCRYPTION_KEY is not configured — required to store Alpaca secrets.',
    );
  }
  if (raw.length >= 44 && /^[A-Za-z0-9+/=]+$/.test(raw)) {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length === KEY_BYTES) return buf;
  }
  return scryptSync(raw, 'earnings-edge-alpaca-v1', KEY_BYTES);
}

export function encryptSecret(plaintext: string): EncryptedBlob {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decryptSecret(blob: EncryptedBlob): string {
  const decipher = createDecipheriv(
    ALGO,
    encryptionKey(),
    Buffer.from(blob.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
