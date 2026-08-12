// ==========================================================================
// Vérification de la signature Meta (WhatsApp Cloud API directe, si utilisée
// en alternative/complément de Twilio). Meta signe chaque requête webhook
// avec HMAC-SHA256 dans l'en-tête "x-hub-signature-256", calculé sur le
// APP_SECRET de l'application Meta.
// Réf: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validate-payloads
// ==========================================================================
import crypto from 'node:crypto';
import { logger } from '../utils/logger.js';

export function verifyMetaSignature(req, res, next) {
  try {
    const signatureHeader = req.headers['x-hub-signature-256'];
    if (!signatureHeader) {
      logger.warn('Webhook Meta sans en-tête de signature — rejeté.');
      return res.status(403).json({ error: 'Signature Meta manquante.' });
    }

    // req.rawBody est capturé par le middleware express.json({verify: ...})
    // configuré dans server.js — indispensable car la signature porte sur
    // le corps BRUT, pas sur l'objet JSON reparsé.
    const expectedSignature =
      'sha256=' +
      crypto
        .createHmac('sha256', process.env.META_APP_SECRET)
        .update(req.rawBody || '')
        .digest('hex');

    const isValid = crypto.timingSafeEqual(
      Buffer.from(signatureHeader),
      Buffer.from(expectedSignature)
    );

    if (!isValid) {
      logger.warn('Signature Meta invalide — requête rejetée.');
      return res.status(403).json({ error: 'Signature Meta invalide.' });
    }

    return next();
  } catch (err) {
    logger.error({ err }, 'Erreur lors de la validation de la signature Meta.');
    return res.status(403).json({ error: 'Validation de signature échouée.' });
  }
}

/**
 * Endpoint GET de vérification initiale du webhook Meta (handshake requis
 * lors de la configuration dans le dashboard Meta for Developers).
 */
export function metaWebhookVerificationHandler(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
}
