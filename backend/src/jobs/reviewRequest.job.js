// ==========================================================================
// JOB — Chasseur d'avis automatisé (Module 2, partie 2).
// 2 heures après la fin d'un chantier (status = 'completed'), envoie
// automatiquement le lien d'avis Google au client final, si pas déjà fait.
// ==========================================================================
import cron from 'node-cron';
import { prisma } from '../config/database.js';
import { sendWhatsAppMessage } from '../services/twilio.service.js';
import { logger } from '../utils/logger.js';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export function startReviewRequestJob() {
  // Toutes les 10 minutes, cherche les chantiers terminés depuis >= 2h sans
  // lien d'avis encore envoyé.
  cron.schedule('*/10 * * * *', async () => {
    try {
      const cutoff = new Date(Date.now() - TWO_HOURS_MS);

      const eligibleAppointments = await prisma.appointment.findMany({
        where: {
          status: 'completed',
          updatedAt: { lte: cutoff },
          clientPhoneNumber: { not: null },
          reviews: { none: {} }, // aucun avis/demande déjà enregistrée
        },
        include: { tenant: true },
      });

      for (const appointment of eligibleAppointments) {
        const reviewLink = buildGoogleReviewLink(appointment.tenant.googleBusinessLocationId);

        await sendWhatsAppMessage(
          `whatsapp:${appointment.clientPhoneNumber}`,
          `Merci d'avoir fait confiance à ${appointment.tenant.companyName || 'notre entreprise'} ! ` +
            `Votre avis compte énormément pour nous : ${reviewLink}`
        );

        await prisma.review.create({
          data: {
            tenantId: appointment.tenantId,
            appointmentId: appointment.id,
            status: 'awaiting_customer',
            reviewLinkSentAt: new Date(),
          },
        });

        logger.info({ appointmentId: appointment.id }, '✉️  Lien d\'avis envoyé au client final.');
      }
    } catch (err) {
      logger.error({ err }, 'Erreur dans le job de relance d\'avis.');
    }
  });

  logger.info('⏱️  Job de relance d\'avis démarré (toutes les 10 minutes).');
}

function buildGoogleReviewLink(locationId) {
  return locationId
    ? `https://search.google.com/local/writereview?placeid=${locationId}`
    : 'https://g.page/r/votre-lien-avis';
}
