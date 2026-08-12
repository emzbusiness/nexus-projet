// ==========================================================================
// Vérification IMPÉRATIVE de la signature cryptographique Twilio sur tous
// les webhooks entrants (WhatsApp via Twilio + Twilio Voice).
// Empêche qu'un tiers malveillant forge une requête se faisant passer pour
// Twilio (usurpation de messages ou de statuts d'appel).
// Réf: https://www.twilio.com/docs/usage/webhooks/webhooks-security
// ==========================================================================
import twilio from 'twilio';
import { logger } from '../utils/logger.js';

export function verifyTwilioSignature(req, res, next) {
  try {
    const signature = req.headers['x-twilio-signature'];
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    // L'URL complète telle que Twilio l'a appelée doit être reconstruite
    // à l'identique (schéma https, host, chemin) — cf. APP_BASE_URL en env.
    const fullUrl = `${process.env.APP_BASE_URL}${req.originalUrl}`;

    if (!signature) {
      logger.warn({ path: req.path }, 'Webhook Twilio sans en-tête de signature — rejeté.');
      return res.status(403).json({ error: 'Signature Twilio manquante.' });
    }

    const isValid = twilio.validateRequest(authToken, signature, fullUrl, req.body);

    if (!isValid) {
      logger.warn({ path: req.path }, 'Signature Twilio invalide — requête rejetée.');
      return res.status(403).json({ error: 'Signature Twilio invalide.' });
    }

    return next();
  } catch (err) {
    logger.error({ err }, 'Erreur lors de la validation de la signature Twilio.');
    return res.status(403).json({ error: 'Validation de signature échouée.' });
  }
}
