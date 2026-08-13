// ==========================================================================
// WEBHOOK WHATSAPP (via Meta Cloud API) + Appels Twilio en mode "Blanc"
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
} from '../services/gemini.service.js';
import { applySettingsIntent } from '../services/intent.service.js';
import { publishBusinessProfilePost } from '../services/google.service.js';
import { sendWhatsAppMessage } from '../services/meta.service.js'; // Envoi des messages via Meta
import { makeOutboundCall } from '../services/twilio.service.js'; // Appel Twilio configuré à blanc
import { handleAppointmentDurationReply, handleDelayConfirmationReply } from '../services/appointment.service.js';
import { handleReviewValidationReply } from '../jobs/reviewValidation.job.js';
import { logger } from '../utils/logger.js';

export const whatsappWebhookRouter = Router();

// 1. Validation du Webhook par Meta
whatsappWebhookRouter.get('/whatsapp', (req, res) => {
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      logger.info('WEBHOOK_VERIFIED par Meta');
      return res.status(200).send(challenge);
    } else {
      return res.sendStatus(403);
    }
  } else {
    return res.sendStatus(400);
  }
});

// 2. Réception des flux Meta
whatsappWebhookRouter.post('/whatsapp', async (req, res) => {
  res.sendStatus(200); // Réponse immédiate à Meta

  try {
    const parsedData = extractMetaMessageData(req.body);
    if (parsedData) {
      await processIncomingWhatsAppMessage(parsedData);
    }
  } catch (err) {
    logger.error({ err }, 'Erreur de traitement du message WhatsApp entrant (Meta).');
  }
});

function extractMetaMessageData(body) {
  try {
    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messageData = value?.messages?.[0];
      const metadata = value?.metadata;

      if (!messageData) return null;

      const fromNumber = messageData.from;
      const toNumber = metadata?.display_phone_number || metadata?.phone_number_id; 
      const messageType = messageData.type;

      let rawBody = '';
      let numMedia = 0;
      let mediaUrl = null;
      let mimeType = null;

      if (messageType === 'text') {
        rawBody = messageData.text?.body || '';
      } else if (messageType === 'image') {
        numMedia = 1;
        rawBody = messageData.image?.caption || '';
        mimeType = messageData.image?.mime_type;
        mediaUrl = messageData.image?.id;
      } else if (messageType === 'audio') {
        numMedia = 1;
        mimeType = messageData.audio?.mime_type;
        mediaUrl = messageData.audio?.id;
      }

      return { fromNumber, toNumber, rawBody, numMedia, mediaUrl, mimeType };
    }
    return null;
  } catch (e) {
    logger.error({ e }, 'Erreur lors du parsing du payload Meta');
    return null;
  }
}

async function processIncomingWhatsAppMessage(data) {
  const { fromNumber, toNumber, rawBody, numMedia, mediaUrl, mimeType } = data;
  const sanitizedMessage = sanitizeUserMessage(rawBody);

  let tenant = await findTenantByWhatsAppNumber(toNumber);
  if (!tenant) {
    logger.warn({ toNumber }, 'Message reçu sur un numéro non rattaché à un tenant — ignoré.');
    return;
  }

  const isFromArtisanHimself = fromNumber === tenant.whatsappPhoneNumber || tenant.whatsappPhoneNumber == null;

  // Onboarding
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

  // Flux conversationnels
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

  // Commandes langage naturel
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

  // Multimodal : Photo
  if (numMedia > 0 && isFromArtisanHimself && mimeType?.startsWith('image')) {
    const seoPost = await generateSeoPostFromJobPhoto({
      imageBuffer: null, 
      mimeType: mimeType,
      sanitizedCaption: sanitizedMessage,
      activityType: tenant.activityType,
      geographicZone: tenant.geographicZone,
    });

    await publishBusinessProfilePost(tenant, { summaryText: seoPost, imageUrl: mediaUrl });
    await sendWhatsAppMessage(fromNumber, `📸 Post publié sur votre fiche Google !\n\n"${seoPost}"`);
    return;
  }

  // Vocal
  if (numMedia > 0 && mimeType?.startsWith('audio')) {
    // Logique de transcription audio si besoin
  }

  // Qualification prospect (Module 3) + Appel Twilio à blanc
  if (!isFromArtisanHimself && sanitizedMessage) {
    const qualification = await qualifyLead(sanitizedMessage);
    
    // 1. Notification texte WhatsApp gratuite via Meta
    await sendWhatsAppMessage(
      tenant.whatsappPhoneNumber,
      `🔔 Nouveau prospect [${qualification.urgency.toUpperCase()} - ${qualification.type}]\n` +
      `De: ${fromNumber}\n` +
      `Résumé: ${qualification.summary}`
    );

    // 2. Gestion des appels (s'exécutera à blanc ou pour de vrai selon les clés Twilio)
    let shouldTriggerCall = false;
    if (tenant.callPreference === 'FIRST_CONTACT') {
      shouldTriggerCall = true;
    } else if (tenant.callPreference === 'URGENCY_ONLY' && qualification.urgency === 'haute') {
      shouldTriggerCall = true;
    }

    if (shouldTriggerCall) {
      logger.info({ tenantId: tenant.id }, 'Tentative de déclenchement d\'appel sortant.');
      await makeOutboundCall(
        tenant.whatsappPhoneNumber, 
        `Bonjour patron. Nouveau prospect au ${fromNumber}. Sujet : ${qualification.summary}`
      );
    }

    return;
  }

  logger.info({ tenantId: tenant.id }, 'Message reçu sans action métier associée.');
}