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
import { 
  detectSettingsIntent, 
  qualifyLead, 
  generateSeoPostFromJobPhoto, 
  transcribeVoiceNote 
} from '../services/gemini.service.js'; // <-- Modifié pour repointer vers Gemini
import { applySettingsIntent } from '../services/intent.service.js';
import { publishBusinessProfilePost } from '../services/google.service.js';
import { sendWhatsAppMessage } from '../services/twilio.service.js';
// import { makeOutboundCall } from '../services/twilio.service.js'; // <-- À décommenter quand ta fonction d'appel sera prête
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
  const fromNumber = body.From; 
  const toNumber = body.To; 
  const rawBody = body.Body || '';
  const numMedia = parseInt(body.NumMedia || '0', 10);

  const sanitizedMessage = sanitizeUserMessage(rawBody);

  // --- 1) Résolution du tenant par numéro WhatsApp dédié -----------------
  let tenant = await findTenantByWhatsAppNumber(toNumber);

  if (!tenant) {
    logger.warn({ toNumber }, 'Message reçu sur un numéro non rattaché à un tenant — ignoré.');
    return;
  }

  const isFromArtisanHimself = fromNumber === tenant.whatsappPhoneNumber || tenant.whatsappPhoneNumber == null;

  // --- 2) Onboarding : numéro fraîchement provisionné après paiement ----
  if (tenant.onboardingStatus === 'pending_onboarding') {
    tenant = await prisma.tenant.update({
      where: { id: tenant.id },
      data: { whatsappPhoneNumber: toNumber },
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
  if (numMedia > 0 && isFromArtisanHimself && body.MediaContentType0?.startsWith('image')) {
    const mediaUrl = body.MediaUrl0;
    const mimeType = body.MediaContentType0;

    // NOUVEAU : On télécharge l'image en Buffer pour Gemini
    const imageResponse = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      auth: { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN },
    });

    const seoPost = await generateSeoPostFromJobPhoto({
      imageBuffer: Buffer.from(imageResponse.data), // Passe le Buffer à Gemini
      mimeType: mimeType,
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
    // NOUVEAU : On passe aussi le mimeType à Gemini
    const transcript = await transcribeVoiceNote(Buffer.from(audioResponse.data), body.MediaContentType0);
    return processIncomingWhatsAppMessage({ ...body, Body: transcript, NumMedia: '0' });
  }

  // --- 7) Par défaut : qualification de prospect (Module 3) -------------
  if (!isFromArtisanHimself && sanitizedMessage) {
    const qualification = await qualifyLead(sanitizedMessage);
    
    // 7.1 - Toujours envoyer la notification texte sur WhatsApp
    await sendWhatsAppMessage(
      tenant.whatsappPhoneNumber,
      `🔔 Nouveau prospect [${qualification.urgency.toUpperCase()} - ${qualification.type}]\n` +
      `De: ${fromNumber}\n` +
      `Résumé: ${qualification.summary}`
    );

    // 7.2 - NOUVEAU : Gestion intelligente des appels selon les préférences BDD
    let shouldTriggerCall = false;

    if (tenant.callPreference === 'FIRST_CONTACT') {
      shouldTriggerCall = true;
    } else if (tenant.callPreference === 'URGENCY_ONLY' && qualification.urgency === 'haute') {
      shouldTriggerCall = true;
    }
    // Si 'WHATSAPP_ONLY' ou 'NEW_BOOKING_ONLY', on ne fait rien à ce stade de premier contact.

    if (shouldTriggerCall) {
      logger.info({ tenantId: tenant.id }, 'Déclenchement d\'un appel sortant (Règles de préférence d\'appel respectées).');
      
      // EXEMPLE DE CODE À ADAPTER selon ta fonction d'appel dans twilio.service.js :
      // await makeOutboundCall(tenant.whatsappPhoneNumber, `Bonjour patron. Nouveau prospect au ${fromNumber}. Sujet : ${qualification.summary}`);
    }

    return;
  }

  logger.info({ tenantId: tenant.id }, 'Message reçu sans action métier associée.');
}