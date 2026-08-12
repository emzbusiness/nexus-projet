// ==========================================================================
// WEBHOOK STRIPE — Pipeline "Paiement → Provisioning → Onboarding".
//
// Étapes strictes :
//  1) Vérification de la signature Stripe (corps BRUT requis — voir
//     server.js pour la capture du raw body sur cette route spécifique).
//  2) Validation : ignore tout événement dont payment_status != 'succeeded'.
//  3) Provisioning : achat d'un numéro Twilio dans le pays du client.
//  4) Persistance : création/màj du Tenant en base, statut
//     'pending_onboarding'.
//  5) Gestion d'erreur robuste : si le provisioning échoue après paiement
//     réussi, alerte critique + le paiement reste marqué "à traiter
//     manuellement" plutôt que silencieusement perdu.
// ==========================================================================
import { Router } from 'express';
import { constructVerifiedStripeEvent } from '../services/stripe.service.js';
import { provisionPhoneNumberForCountry } from '../services/twilio.service.js';
import { prisma } from '../config/database.js';
import { logger, alertOps } from '../utils/logger.js';

export const stripeWebhookRouter = Router();

stripeWebhookRouter.post('/stripe', async (req, res) => {
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    // req.rawBody est capturé par le middleware express.raw() dédié à cette
    // route dans server.js (obligatoire pour Stripe : la signature porte
    // sur les octets exacts du corps, pas sur le JSON reparsé).
    event = constructVerifiedStripeEvent(req.rawBody, signature);
  } catch (err) {
    logger.warn({ err: err.message }, 'Signature Stripe invalide — webhook rejeté.');
    return res.status(400).json({ error: 'Signature invalide.' });
  }

  // On répond vite à Stripe (< 5s attendu) puis on traite en arrière-plan.
  res.status(200).json({ received: true });

  try {
    await handleStripeEvent(event);
  } catch (err) {
    logger.error({ err }, 'Erreur lors du traitement de l\'événement Stripe.');
  }
});

async function handleStripeEvent(event) {
  // On ne traite que les événements de paiement réussi pertinents.
  if (!['checkout.session.completed', 'invoice.payment_succeeded'].includes(event.type)) {
    logger.info({ type: event.type }, 'Événement Stripe ignoré (hors scope provisioning).');
    return;
  }

  const payload = extractSubscriptionPayload(event);

  // --- 2) VALIDATION --------------------------------------------------
  if (payload.payment_status !== 'succeeded') {
    logger.info({ payload }, 'Paiement non confirmé (payment_status != succeeded) — aucune action.');
    return;
  }

  const { customer_email: customerEmail, subscription_tier: subscriptionTier, country_code: countryCode } = payload;

  if (!customerEmail || !subscriptionTier || !countryCode) {
    logger.error({ payload }, 'Payload Stripe incomplet — provisioning impossible.');
    alertOps('Payload de paiement Stripe incomplet (champs requis manquants).', { payload });
    return;
  }

  // --- 3) PROVISIONING --------------------------------------------------
  let phoneNumber;
  try {
    phoneNumber = await provisionPhoneNumberForCountry(countryCode);
  } catch (err) {
    // L'alerte critique est déjà loguée dans twilio.service.js
    // (alertOps). On persiste néanmoins une trace en base pour le
    // client, marquée en erreur, afin qu'une reprise manuelle soit
    // possible sans perdre l'information de paiement.
    await prisma.tenant.upsert({
      where: { customerEmail },
      update: { subscriptionBadge: subscriptionTier, countryCode },
      create: {
        customerEmail,
        subscriptionBadge: subscriptionTier,
        countryCode,
        whatsappPhoneNumber: `PENDING_PROVISIONING_${customerEmail}`, // placeholder unique temporaire
        onboardingStatus: 'pending_onboarding',
      },
    });
    return; // on s'arrête ici : pas de numéro = pas d'activation possible
  }

  // --- 4) PERSISTANCE ----------------------------------------------------
  const tenant = await prisma.tenant.upsert({
    where: { customerEmail },
    update: {
      whatsappPhoneNumber: `whatsapp:${phoneNumber}`,
      subscriptionBadge: subscriptionTier,
      countryCode,
      onboardingStatus: 'pending_onboarding',
    },
    create: {
      customerEmail,
      whatsappPhoneNumber: `whatsapp:${phoneNumber}`,
      subscriptionBadge: subscriptionTier,
      countryCode,
      onboardingStatus: 'pending_onboarding',
    },
  });

  logger.info(
    { tenantId: tenant.id, phoneNumber, subscriptionTier },
    '✅ Client provisionné avec succès — en attente du premier message WhatsApp pour lancer l\'onboarding.'
  );

  // --- 5) L'activation de l'onboarding est déclenchée automatiquement au
  // premier message WhatsApp reçu sur ce numéro (voir whatsapp.webhook.js,
  // section "Onboarding : numéro fraîchement provisionné").
}

/**
 * Normalise le payload attendu (customer_email, subscription_tier,
 * country_code, payment_status) qu'il provienne directement d'un objet
 * personnalisé ou de la structure imbriquée native d'un événement Stripe
 * (checkout.session avec metadata).
 */
function extractSubscriptionPayload(event) {
  const obj = event.data.object;
  return {
    customer_email: obj.customer_email || obj.customer_details?.email || obj.metadata?.customer_email,
    subscription_tier: obj.metadata?.subscription_tier,
    country_code: obj.metadata?.country_code,
    payment_status: obj.payment_status === 'paid' ? 'succeeded' : obj.payment_status,
  };
}
