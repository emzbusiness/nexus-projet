// ==========================================================================
// JOB — Boucle de validation des réponses aux avis (Module 2, partie 1).
// Récupère les nouveaux avis Google, génère une réponse IA, et l'envoie
// à l'artisan sur WhatsApp pour validation avant publication.
// ==========================================================================
import cron from 'node-cron';
import { prisma } from '../config/database.js';
import { fetchRecentReviews, publishReviewReply } from '../services/google.service.js';
import { generateReviewReply } from '../services/gemini.service.js';
import { sendWhatsAppMessage } from '../services/twilio.service.js';
import { setConversationState } from '../services/tenant.service.js';
import { logger } from '../utils/logger.js';

export function startReviewValidationJob() {
  cron.schedule('*/15 * * * *', async () => {
    try {
      const connectedTenants = await prisma.tenant.findMany({
        where: { googleBusinessLocationId: { not: null }, onboardingStatus: 'completed' },
      });

      for (const tenant of connectedTenants) {
        const googleReviews = await fetchRecentReviews(tenant);

        for (const gReview of googleReviews) {
          const alreadyTracked = await prisma.review.findUnique({
            where: { googleReviewId: gReview.reviewId },
          });
          if (alreadyTracked) continue;

          const aiDraftReply = await generateReviewReply({
            reviewerName: gReview.reviewer?.displayName,
            rating: mapStarRatingToNumber(gReview.starRating),
            reviewText: gReview.comment,
            companyName: tenant.companyName,
          });

          const review = await prisma.review.create({
            data: {
              tenantId: tenant.id,
              googleReviewId: gReview.reviewId,
              reviewerName: gReview.reviewer?.displayName,
              rating: mapStarRatingToNumber(gReview.starRating),
              reviewText: gReview.comment,
              aiDraftReply,
              status: 'pending_validation',
            },
          });

          await setConversationState(tenant.id, { flow: 'awaiting_review_validation', reviewId: review.id });

          await sendWhatsAppMessage(
            tenant.whatsappPhoneNumber,
            `⭐ Nouvel avis de ${review.reviewerName} (${review.rating}/5) :\n"${review.reviewText}"\n\n` +
              `Voici ma réponse proposée :\n"${aiDraftReply}"\n\n` +
              `Veux-tu que je publie cette réponse ? (Oui/Non)`
          );
        }
      }
    } catch (err) {
      logger.error({ err }, 'Erreur dans le job de validation des avis.');
    }
  });

  logger.info('⏱️  Job de validation des avis démarré (toutes les 15 minutes).');
}

/**
 * Traite la réponse "Oui/Non" de l'artisan à une proposition de réponse
 * d'avis — à appeler depuis le webhook WhatsApp lorsque
 * state.flow === 'awaiting_review_validation'.
 */
export async function handleReviewValidationReply(tenant, state, sanitizedMessage) {
  const review = await prisma.review.findUnique({ where: { id: state.reviewId } });
  await setConversationState(tenant.id, null);

  const approved = /^(o|oui|y|yes)/i.test(sanitizedMessage.trim());
  if (!approved) {
    await prisma.review.update({ where: { id: review.id }, data: { status: 'rejected' } });
    return 'Ok, réponse non publiée. Vous pouvez me redemander une nouvelle proposition plus tard.';
  }

  await publishReviewReply(tenant, review.googleReviewId, review.aiDraftReply);
  await prisma.review.update({
    where: { id: review.id },
    data: { status: 'published', publishedAt: new Date() },
  });

  return '✅ Réponse publiée sur Google !';
}

function mapStarRatingToNumber(starRating) {
  const map = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return map[starRating] || null;
}
