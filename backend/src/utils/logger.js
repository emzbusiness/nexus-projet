// ==========================================================================
// Logger central (pino). Utilisé partout au lieu de console.log pour avoir
// des logs structurés, horodatés, et filtrables par niveau en production.
// ==========================================================================
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
});

/**
 * Alerte critique : à utiliser pour tout incident nécessitant une
 * intervention humaine immédiate (ex: échec de provisioning Twilio après
 * paiement réussi). En production, ce point peut être branché sur un
 * service d'astreinte (PagerDuty, Slack, email…) — ici on garantit au
 * minimum une trace de log de niveau "fatal" impossible à manquer.
 */
export function alertOps(message, context = {}) {
  logger.fatal({ alert: true, ...context }, `🚨 ALERTE OPS: ${message}`);
  // TODO(prod): brancher ici un envoi Slack/email vers ADMIN_ALERT_EMAIL.
}
