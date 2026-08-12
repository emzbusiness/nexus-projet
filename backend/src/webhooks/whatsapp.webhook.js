// ==========================================================================
// WEBHOOK WHATSAPP (via Twilio) — point d'entrée central du SaaS.
// Toute la logique de routage multi-tenant, d'onboarding, de commandes en
// langage naturel, et de filtrage par badge Premium démarre ici.
//
// Sécurité : ce routeur est monté DERRIÈRE verifyTwilioSignature() et
// webhookRateLimiter dans server.js — ne jamais l'exposer sans ces deux
// protections.
// ==========================================================================
import { Router } from 'express';
import axios from 'axios';
import { prisma } from '../config/database.js';
import {
  findTenantByWhatsAppNumber,
  getConversationState,
  isPremiumTenant,
} from '../services/tenant.service.js';
import { startOnboarding, handleOnboardingReply } from '../services/onboarding.service.js';
import { sanitizeUserMessage } from '../utils/sanitize.js';
import { detectSettingsIntent, qualifyLead, generateSeoPostFromJobPhoto, transcribeVoiceNote } from '../services/openai.service.js';
import { applySettingsIntent } from '../services/intent.service.js';
import { publishBusinessProfilePost } from '../services/google.service.js';
import { sendWhatsAppMessage } from '../services/twilio.service.js';
import { handleAppointmentDurationReply, handleDelayConfirmationReply } from '../services/appointment.service.js';
import { handleReviewValidationReply } from '../jobs/reviewValidation.job.js';
import { logger } from '../utils/logger.js';

export const whatsappWebhookRouter = Router();

whatsappWebhookRouter.post('/whatsapp', async (req, res) => {
  // On répond immédiatement 200 à Twilio pour éviter les retries/timeouts,
  // puis on traite le message de façon asynchrone.
  res.status(200).send('<Response></Response>');

  try {
    await processIncomingWhatsAppMessage(req.body);
  } catch (err) {
    logger.error({ err }, 'Erreur de traitement du message WhatsApp entrant.');
  }
});

async function processIncomingWhatsAppMessage(body) {
  // Le "From" WhatsApp (client final ou artisan) et le "To" (notre numéro
  // Twilio dédié à CE tenant) sont la base du routage multi-tenant : c'est
  // "To" qui identifie de façon unique l'entreprise cliente concernée.
  const fromNumber = body.From; // ex: "whatsapp:+33612345678"
  const toNumber = body.To; // ex: "whatsapp:+14155238886" (numéro dédié du tenant)
  const rawBody = body.Body || '';
  const numMedia = parseInt(body.NumMedia || '0', 10);

  const sanitizedMessage = sanitizeUserMessage(rawBody);

  // --- 1) Résolution du tenant par numéro WhatsApp dédié -----------------
  let tenant = await findTenantByWhatsAppNumber(toNumber);

  if (!tenant) {
    logger.warn({ toNumber }, 'Message reçu sur un numéro non rattaché à un tenant — ignoré.');
    return;
  }

  // Le "From" de l'expéditeur doit correspondre au tenant lui-même pour
  // toute la logique de configuration/onboarding. Si un client final écrit
  // sur ce même numéro (ex: réponse à une demande d'avis), on le route
  // différemment (non couvert dans ce court-circuit — cf. logique métier
  // spécifique aux avis/prospects, distincte de la config artisan).
  const isFromArtisanHimself = fromNumber === tenant.whatsappPhoneNumber || tenant.whatsappPhoneNumber == null;

  // --- 2) Onboarding : numéro fraîchement provisionné après paiement ----
  if (tenant.onboardingStatus === 'pending_onboarding') {
    // Premier message reçu sur ce numéro → on associe désormais ce
    // "From" comme étant le numéro personnel de l'artisan.
    tenant = await prisma.tenant.update({
      where: { id: tenant.id },
      data: { whatsappPhoneNumber: toNumber }, // le numéro dédié reste la clé de routage stable
    });
    const firstPrompt = await startOnboarding(tenant);
    await sendWhatsAppMessage(fromNumber, firstPrompt);
    return;
  }

  if (tenant.onboardingStatus === 'in_progress') {
    const state = getConversationState(tenant);
    if (state?.flow === 'onboarding') {
      const nextPrompt = await handleOnboardingReply(tenant, state, sanitizedMessage);
      await sendWhatsAppMessage(fromNumber, nextPrompt);
      return;
    }
  }

  // --- 3) Flux de conversation en cours (agenda / retard) — badge premium
  const state = getConversationState(tenant);
  if (state?.flow === 'awaiting_appointment_duration' && isPremiumTenant(tenant)) {
    const reply = await handleAppointmentDurationReply(tenant, state, sanitizedMessage);
    await sendWhatsAppMessage(fromNumber, reply);
    return;
  }
  if (state?.flow === 'awaiting_delay_confirmation' && isPremiumTenant(tenant)) {
    const reply = await handleDelayConfirmationReply(tenant, state, sanitizedMessage);
    await sendWhatsAppMessage(fromNumber, reply);
    return;
  }
  if (state?.flow === 'awaiting_review_validation') {
    const reply = await handleReviewValidationReply(tenant, state, sanitizedMessage);
    await sendWhatsAppMessage(fromNumber, reply);
    return;
  }

  // --- 4) Commandes en langage naturel (Module 1) — priorité sur le reste
  if (isFromArtisanHimself && sanitizedMessage) {
    const { intent, extractedValue } = await detectSettingsIntent(sanitizedMessage);
    if (intent !== 'NONE') {
      const confirmation = await applySettingsIntent(tenant, { intent, extractedValue });
      if (confirmation) {
        await sendWhatsAppMessage(fromNumber, confirmation);
        return;
      }
    }
  }

  // --- 5) Traitement multimodal : photo de chantier + légende (Module 2) -
  if (numMedia > 0 && isFromArtisanHimself) {
    const mediaUrl = body.MediaUrl0;
    const seoPost = await generateSeoPostFromJobPhoto({
      imageUrl: mediaUrl,
      sanitizedCaption: sanitizedMessage,
      activityType: tenant.activityType,
      geographicZone: tenant.geographicZone,
    });

    await publishBusinessProfilePost(tenant, { summaryText: seoPost, imageUrl: mediaUrl });
    await sendWhatsAppMessage(
      fromNumber,
      `📸 Post publié sur votre fiche Google !\n\n"${seoPost}"`
    );
    return;
  }

  // --- 6) Message vocal (note audio) : transcription puis re-traitement --
  if (numMedia > 0 && body.MediaContentType0?.startsWith('audio')) {
    const audioResponse = await axios.get(body.MediaUrl0, {
      responseType: 'arraybuffer',
      auth: { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN },
    });
    const transcript = await transcribeVoiceNote(Buffer.from(audioResponse.data));
    return processIncomingWhatsAppMessage({ ...body, Body: transcript, NumMedia: '0' });
  }

  // --- 7) Par défaut : qualification de prospect (Module 3) -------------
  if (!isFromArtisanHimself && sanitizedMessage) {
    const qualification = await qualifyLead(sanitizedMessage);
    await sendWhatsAppMessage(
      tenant.whatsappPhoneNumber,
      `🔔 Nouveau prospect [${qualification.urgency.toUpperCase()} - ${qualification.type}]\n` +
        `De: ${fromNumber}\n` +
        `Résumé: ${qualification.summary}`
    );
    return;
  }

  logger.info({ tenantId: tenant.id }, 'Message reçu sans action métier associée.');
}
