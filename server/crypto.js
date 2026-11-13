import crypto from 'node:crypto';

/*
 * Encrypt small secrets (an SMTP password, an API key) for storage in a
 * settings table. AES-256-GCM, a random IV per value, stored as one base64
 * blob (iv | tag | ciphertext) so the column stays plain TEXT. The key is
 * derived from a secret the app already has (its session secret), so there is
 * no second secret to provision. `salt` scopes the key to one purpose.
 */
const keyFor = (secret, salt) => {
  if (!secret) throw new Error('encrypt/decrypt: a secret is required');
  return crypto.scryptSync(secret, salt, 32);
};

export function encrypt(plaintext, secret, salt = 'mn-kit-settings') {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(secret, salt), iv);
  const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function decrypt(payload, secret, salt = 'mn-kit-settings') {
  const buf = Buffer.from(payload, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(secret, salt), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}
