// ==========================================================================
// Configuration centrale de sécurité : chiffrement au repos des tokens
// OAuth (Google Business Profile) et validation des variables d'env requises.
// ==========================================================================
import crypto from 'node:crypto';

const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'OPENAI_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'ENCRYPTION_KEY',
];

/**
 * Vérifie au démarrage que tous les secrets nécessaires sont présents.
 * Fait échouer le boot immédiatement plutôt que de tomber en erreur plus
 * tard sur un endpoint critique (fail-fast).
 */
export function assertEnvironment() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `[SECURITY] Variables d'environnement manquantes : ${missing.join(', ')}. ` +
        `Vérifiez votre fichier .env (voir .env.example).`
    );
  }
  if (Buffer.from(process.env.ENCRYPTION_KEY, 'hex').length !== 32) {
    throw new Error(
      '[SECURITY] ENCRYPTION_KEY doit être une chaîne hexadécimale de 32 octets (64 caractères hex).'
    );
  }
}

const ALGORITHM = 'aes-256-gcm';

/**
 * Chiffre une chaîne sensible (ex: refresh_token Google) avant stockage en base.
 * Retourne un blob compact "iv:authTag:cipherText" encodé en base64.
 */
export function encryptSecret(plainText) {
  if (!plainText) return null;
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Déchiffre une valeur produite par encryptSecret().
 */
export function decryptSecret(payload) {
  if (!payload) return null;
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
