// ==========================================================================
// Service Tenant — accès centralisé aux données d'un artisan (multi-tenant).
// TOUTE requête WhatsApp entrante doit résoudre son tenant via
// findTenantByWhatsAppNumber() : c'est la clé de voûte de l'isolation
// multi-tenant (un seul serveur, N entreprises, jamais de fuite croisée).
// ==========================================================================
import { prisma } from '../config/database.js';

export async function findTenantByWhatsAppNumber(whatsappPhoneNumber) {
  return prisma.tenant.findUnique({ where: { whatsappPhoneNumber } });
}

export async function updateTenant(tenantId, data) {
  return prisma.tenant.update({ where: { id: tenantId }, data });
}

/**
 * Garde de sécurité fonctionnelle (Module 4) : vérifie STRICTEMENT que le
 * tenant est badge "premium" avant d'autoriser trajet/agenda/GPS proactif.
 * Utilisée à chaque point d'entrée de ces fonctionnalités — jamais contourné.
 */
export function isPremiumTenant(tenant) {
  return tenant?.subscriptionBadge === 'premium';
}

/**
 * Utilitaire de conversation state (machine à états JSON) utilisé par
 * l'onboarding et les flux multi-messages (ex: création de RDV en plusieurs
 * échanges).
 */
export async function setConversationState(tenantId, state) {
  return prisma.tenant.update({
    where: { id: tenantId },
    data: { conversationState: state ? JSON.stringify(state) : null },
  });
}

export function getConversationState(tenant) {
  if (!tenant.conversationState) return null;
  try {
    return JSON.parse(tenant.conversationState);
  } catch {
    return null;
  }
}
