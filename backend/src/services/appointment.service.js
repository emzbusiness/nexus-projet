// ==========================================================================
// Module 4 — Agenda, trajet et ponctualité (RÉSERVÉ AU BADGE PREMIUM).
// Toute fonction ici doit être appelée derrière une vérification
// isPremiumTenant() explicite côté appelant (webhook / job) — double
// vérification défensive également faite ici.
// ==========================================================================
import { prisma } from '../config/database.js';
import { setConversationState, isPremiumTenant } from './tenant.service.js';
import { sendWhatsAppMessage } from './meta.service.js';
import { triggerVoiceAlertCall } from './twilio.service.js';
import { computeTravelTimeMinutes, isDelayImminent, computeRecalculatedEta } from './location.service.js';
import { logger } from '../utils/logger.js';

/**
 * Crée un nouveau RDV et lance immédiatement la question de durée de
 * chantier (le bot demande la durée à chaque RDV, cf. cahier des charges).
 */
export async function createAppointment(tenant, { clientName, clientPhoneNumber, address, scheduledAt, latitude, longitude }) {
  if (!isPremiumTenant(tenant)) {
    throw new PremiumRequiredError();
  }

  const appointment = await prisma.appointment.create({
    data: { tenantId: tenant.id, clientName, clientPhoneNumber, address, scheduledAt, latitude, longitude },
  });

  await setConversationState(tenant.id, {
    flow: 'awaiting_appointment_duration',
    appointmentId: appointment.id,
  });

  return appointment;
}

export async function handleAppointmentDurationReply(tenant, state, sanitizedMessage) {
  const minutes = parseInt(sanitizedMessage.replace(/\D/g, ''), 10);
  if (Number.isNaN(minutes)) {
    return 'Merci d\'indiquer la durée estimée du chantier en minutes (ex: "90").';
  }

  await prisma.appointment.update({
    where: { id: state.appointmentId },
    data: { estimatedDurationMin: minutes },
  });

  await setConversationState(tenant.id, null);
  return `✅ Durée enregistrée (${minutes} min). Je surveillerai votre trajet vers ce RDV si le GPS est activé.`;
}

/** Erreur explicite levée si une fonctionnalité premium est appelée à tort. */
export class PremiumRequiredError extends Error {
  constructor() {
    super('Cette fonctionnalité est réservée au badge PREMIUM.');
    this.statusCode = 403;
  }
}

/**
 * Cœur du "Traqueur GPS & Alerte Proactive" (Module 4) — appelé
 * périodiquement par le job de fond (src/jobs/locationTracker.job.js)
 * UNIQUEMENT pour les tenants premium avec locationTrackingActive = true.
 */
export async function checkUpcomingAppointmentDelay(tenant) {
  // Double vérification défensive du badge, même si le job filtre déjà.
  if (!isPremiumTenant(tenant) || !tenant.locationTrackingActive) return;
  if (!tenant.lastKnownLat || !tenant.lastKnownLng) return;

  const nextAppointment = await prisma.appointment.findFirst({
    where: {
      tenantId: tenant.id,
      status: { in: ['scheduled', 'en_route'] },
      scheduledAt: { gte: new Date(), lte: new Date(Date.now() + 90 * 60000) }, // dans les 90 prochaines minutes
    },
    orderBy: { scheduledAt: 'asc' },
  });

  if (!nextAppointment || nextAppointment.delayNotifiedAt) return;

  const travelMinutes = await computeTravelTimeMinutes({
    originLat: tenant.lastKnownLat,
    originLng: tenant.lastKnownLng,
    destinationAddress: nextAppointment.address,
  });

  if (travelMinutes == null) return;

  await prisma.appointment.update({
    where: { id: nextAppointment.id },
    data: { estimatedTravelMin: travelMinutes },
  });

  if (!isDelayImminent({ scheduledAt: nextAppointment.scheduledAt, travelMinutes })) return;

  const minutesUntilAppointment = Math.round(
    (new Date(nextAppointment.scheduledAt).getTime() - Date.now()) / 60000
  );

  const alertMessage =
    `Salut ! Tu as un RDV chez ${nextAppointment.clientName} dans ${minutesUntilAppointment} minutes ` +
    `et il y a ${travelMinutes} minutes de route. Es-tu en route ?`;

  await setConversationState(tenant.id, {
    flow: 'awaiting_delay_confirmation',
    appointmentId: nextAppointment.id,
  });

  if (tenant.notificationPreference === 'voice') {
    await triggerVoiceAlertCall({
      toPhoneNumber: tenant.whatsappPhoneNumber.replace('whatsapp:', ''),
      message: alertMessage,
    });
  } else {
    await sendWhatsAppMessage(tenant.whatsappPhoneNumber, alertMessage);
  }

  await prisma.appointment.update({
    where: { id: nextAppointment.id },
    data: { delayNotifiedAt: new Date(), status: 'delayed' },
  });

  logger.info({ tenantId: tenant.id, appointmentId: nextAppointment.id }, '🚨 Alerte de retard envoyée.');
}

/**
 * Traite la réponse de l'artisan à l'alerte de retard ("oui je suis en
 * retard" / "non c'est bon") — si retard confirmé, informe poliment le
 * client final avec l'heure d'arrivée recalculée.
 */
export async function handleDelayConfirmationReply(tenant, state, sanitizedMessage) {
  const appointment = await prisma.appointment.findUnique({ where: { id: state.appointmentId } });
  await setConversationState(tenant.id, null);

  const confirmsDelay = /retard|oui|en route difficile|pas encore/i.test(sanitizedMessage);
  if (!confirmsDelay || !appointment?.clientPhoneNumber) {
    return 'Ok, merci pour la confirmation !';
  }

  const travelMinutes = appointment.estimatedTravelMin || 20;
  const newEta = computeRecalculatedEta(travelMinutes);

  await prisma.appointment.update({
    where: { id: appointment.id },
    data: { recalculatedEta: newEta },
  });

  const politeMessage =
    `Bonjour, votre intervenant ${tenant.companyName || ''} a été légèrement retardé. ` +
    `Nouvelle heure d'arrivée estimée : ${newEta.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}. ` +
    `Merci de votre patience !`;

  await sendWhatsAppMessage(`whatsapp:${appointment.clientPhoneNumber}`, politeMessage);

  return '✅ Le client a été informé du nouvel horaire estimé.';
}

/**
 * Marque un chantier comme terminé — déclenche le minuteur de 2h pour
 * l'envoi du lien d'avis (Module 2, cf. jobs/reviewRequest.job.js).
 */
export async function markAppointmentCompleted(appointmentId) {
  return prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: 'completed' },
  });
}
