// ==========================================================================
// Service Twilio — envoi de messages WhatsApp, appels vocaux automatisés,
// et provisioning de numéros dédiés après paiement réussi (pipeline Stripe).
// ==========================================================================
import twilio from 'twilio';
import { logger, alertOps } from '../utils/logger.js';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

/**
 * Envoie un message WhatsApp texte simple à un tenant ou un client final.
 * @param {string} to - Numéro au format "whatsapp:+33612345678"
 */
export async function sendWhatsAppMessage(to, body) {
  return client.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM,
    to,
    body,
  });
}

/**
 * Envoie un message WhatsApp avec pièce jointe (ex: lien d'avis, image générée).
 */
export async function sendWhatsAppMedia(to, body, mediaUrl) {
  return client.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM,
    to,
    body,
    mediaUrl: [mediaUrl],
  });
}

/**
 * Déclenche un appel vocal automatisé avec synthèse vocale (Module 4 —
 * alerte proactive de retard). Utilise TwiML <Say> avec voix française.
 */
export async function triggerVoiceAlertCall({ toPhoneNumber, message }) {
  const twimlEndpoint = `${process.env.APP_BASE_URL}/webhooks/twilio-voice/say?message=${encodeURIComponent(message)}`;

  return client.calls.create({
    from: process.env.TWILIO_VOICE_FROM,
    to: toPhoneNumber,
    url: twimlEndpoint,
  });
}

/**
 * Génère le TwiML de réponse pour un appel de type "Say" (voix IA).
 */
export function buildSayTwiml(message) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();
  response.say({ voice: 'Polly.Celine', language: 'fr-FR' }, message);
  return response.toString();
}

/**
 * PROVISIONING — achète un nouveau numéro Twilio compatible WhatsApp dans le
 * pays du client (country_code du paiement Stripe), puis l'attache au
 * Messaging Service WhatsApp. Appelé par le pipeline de paiement.
 *
 * Gestion d'erreur robuste : si l'achat échoue après un paiement réussi,
 * on logue une alerte critique (voir utils/logger.js#alertOps) pour
 * intervention manuelle — le client a payé, il ne doit jamais être bloqué
 * silencieusement.
 */
export async function provisionPhoneNumberForCountry(countryCode) {
  try {
    const available = await client
      .availablePhoneNumbers(countryCode)
      .local.list({ smsEnabled: true, limit: 1 });

    if (!available.length) {
      throw new Error(`Aucun numéro disponible pour le pays "${countryCode}".`);
    }

    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber: available[0].phoneNumber,
      smsUrl: `${process.env.APP_BASE_URL}/webhooks/whatsapp`,
      smsMethod: 'POST',
      voiceUrl: `${process.env.APP_BASE_URL}/webhooks/twilio-voice`,
      voiceMethod: 'POST',
    });

    logger.info({ phoneNumber: purchased.phoneNumber, countryCode }, '✅ Numéro Twilio provisionné.');
    return purchased.phoneNumber;
  } catch (err) {
    alertOps('Échec du provisioning d\'un numéro Twilio après paiement réussi.', {
      countryCode,
      error: err.message,
    });
    throw err; // propagé pour que l'appelant puisse aussi réagir (ex: statut d'erreur en base)
  }
}
