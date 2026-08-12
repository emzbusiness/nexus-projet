// ==========================================================================
// Limitation de débit (anti DDoS / anti spam de messages).
// Deux profils : un large pour l'API publique/webhooks légitimes fréquents
// (Twilio peut renvoyer beaucoup de statuts), un strict pour les endpoints
// sensibles (paiement, admin).
// ==========================================================================
import rateLimit from 'express-rate-limit';

/**
 * Limite appliquée aux webhooks WhatsApp / Voice entrants.
 * 60 requêtes / minute / IP est largement suffisant pour un trafic
 * WhatsApp légitime (Twilio proxie les appels, donc l'IP source est stable),
 * tout en bloquant un flood applicatif.
 */
export const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes. Merci de réessayer dans un instant.' },
});

/**
 * Limite stricte pour les webhooks de paiement (Stripe) : le volume attendu
 * est faible, un pic anormal est donc suspect.
 */
export const paymentWebhookRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Limite globale par défaut pour toute route publique non listée ci-dessus.
 */
export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
