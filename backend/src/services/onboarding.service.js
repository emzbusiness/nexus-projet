// ==========================================================================
// Module 1 — Onboarding WhatsApp guidé.
// Machine à états simple stockée dans Tenant.conversationState : à chaque
// message reçu d'un tenant en cours d'onboarding, on avance d'une étape.
// ==========================================================================
import { setConversationState } from './tenant.service.js';
import { prisma } from '../config/database.js';

const STEPS = [
  { key: 'companyName', prompt: 'Bienvenue ! 🎉 Pour commencer, quel est le nom de votre entreprise ?' },
  { key: 'activityType', prompt: 'Merci ! Quelle est votre activité (plombier, électricien, paysagiste...) ?' },
  { key: 'geographicZone', prompt: 'Parfait. Quelle est votre zone géographique d\'intervention ?' },
  { key: 'locationTrackingActive', prompt: 'Souhaitez-vous activer le suivi GPS pour les alertes de ponctualité ? (Oui/Non)' },
  { key: 'notificationPreference', prompt: 'Préférez-vous être alerté par texte ou par message vocal ? (texte/vocal)' },
];

/**
 * Démarre le parcours d'accueil pour un numéro inconnu ou marqué
 * "pending_onboarding" (provisionné après paiement Stripe).
 */
export async function startOnboarding(tenant) {
  await setConversationState(tenant.id, { flow: 'onboarding', stepIndex: 0 });
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { onboardingStatus: 'in_progress' },
  });
  return STEPS[0].prompt;
}

/**
 * Traite la réponse de l'utilisateur pour l'étape courante de l'onboarding,
 * enregistre la valeur, et retourne le prochain message à envoyer (ou un
 * message de clôture si l'onboarding est terminé).
 */
export async function handleOnboardingReply(tenant, state, sanitizedMessage) {
  const step = STEPS[state.stepIndex];
  const value = normalizeStepValue(step.key, sanitizedMessage);

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { [step.key]: value },
  });

  const nextIndex = state.stepIndex + 1;

  if (nextIndex >= STEPS.length) {
    await setConversationState(tenant.id, null);
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { onboardingStatus: 'completed' },
    });
    return (
      '✅ Configuration terminée ! Votre assistant est opérationnel.\n' +
      'Astuce : vous pouvez à tout moment modifier vos réglages en m\'écrivant, par exemple ' +
      '"Coupe ma localisation" ou "Passe en mode texte uniquement".'
    );
  }

  await setConversationState(tenant.id, { flow: 'onboarding', stepIndex: nextIndex });
  return STEPS[nextIndex].prompt;
}

function normalizeStepValue(key, rawValue) {
  if (key === 'locationTrackingActive') {
    return /^(o|oui|y|yes)/i.test(rawValue.trim());
  }
  if (key === 'notificationPreference') {
    return /vocal|voice/i.test(rawValue) ? 'voice' : 'text';
  }
  return rawValue.trim();
}
