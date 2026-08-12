// ==========================================================================
// Service Stripe — vérification de signature webhook + lecture du payload
// de paiement. La logique de provisioning (achat numéro Twilio, création
// tenant) vit dans webhooks/stripe.webhook.js pour rester proche du flux
// HTTP ; ce service ne fait que l'intégration SDK pure.
// ==========================================================================
import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Vérifie la signature cryptographique du webhook Stripe à partir du corps
 * BRUT de la requête (obligatoire — Stripe signe les octets exacts envoyés).
 * Lève une exception si la signature est invalide.
 */
export function constructVerifiedStripeEvent(rawBody, signatureHeader) {
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, process.env.STRIPE_WEBHOOK_SECRET);
}
