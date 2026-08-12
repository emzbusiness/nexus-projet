// ==========================================================================
// JOB — Surveillance périodique de la position GPS (Module 4, premium).
// Ne traite QUE les tenants premium ayant activé le tracking : c'est ici
// que le filtrage par badge est appliqué au niveau de la requête SQL
// elle-même, en première ligne de défense (défense en profondeur, en plus
// des vérifications applicatives dans appointment.service.js).
// ==========================================================================
import cron from 'node-cron';
import { prisma } from '../config/database.js';
import { checkUpcomingAppointmentDelay } from '../services/appointment.service.js';
import { logger } from '../utils/logger.js';

export function startLocationTrackerJob() {
  // Toutes les 5 minutes.
  cron.schedule('*/5 * * * *', async () => {
    try {
      const eligibleTenants = await prisma.tenant.findMany({
        where: {
          subscriptionBadge: 'premium', // <-- filtrage strict badge premium
          locationTrackingActive: true,
          onboardingStatus: 'completed',
        },
      });

      for (const tenant of eligibleTenants) {
        await checkUpcomingAppointmentDelay(tenant);
      }
    } catch (err) {
      logger.error({ err }, 'Erreur dans le job de suivi GPS.');
    }
  });

  logger.info('⏱️  Job de suivi GPS démarré (toutes les 5 minutes).');
}

/**
 * Point d'entrée à appeler depuis un endpoint interne / une intégration
 * mobile pour mettre à jour la position GPS courante de l'artisan.
 * (ex: une application mobile compagnon envoie sa position toutes les X
 * minutes lorsque le tracking est actif.)
 */
export async function updateTenantLocation(tenantId, { lat, lng }) {
  return prisma.tenant.update({
    where: { id: tenantId },
    data: { lastKnownLat: lat, lastKnownLng: lng, lastLocationUpdateAt: new Date() },
  });
}
