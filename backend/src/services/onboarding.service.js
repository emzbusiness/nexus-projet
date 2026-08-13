// ==========================================================================
// Module 1 — Onboarding WhatsApp guidé & ultra-complet.
// Machine à états stockée dans Tenant.conversationState.
// À chaque message reçu d'un tenant en cours d'onboarding, on avance d'une étape.
// ==========================================================================
import { setConversationState } from './tenant.service.js';
import { prisma } from '../config/database.js';

const STEPS = [
  {
    key: 'companyName',
    prompt: 'Bienvenue chez Nexus Pro ! 🎉 Pour configurer votre assistant sur-mesure, posons quelques bases.\n\n1️⃣ Quel est le **nom de votre entreprise** ou votre nom d\'artisan ?'
  },
  {
    key: 'activityType',
    prompt: '2️⃣ Quelle est votre **activité principale** (ex: Plombier, Électricien, Couvreur, Chauffagiste...) ?'
  },
  {
    key: 'geographicZone',
    prompt: '3️⃣ Quelle est votre **zone géographique d\'intervention** (ex: Bordeaux et 30 km aux alentours, Métropole Lilloise...) ?'
  },
  {
    key: 'baseAddress',
    prompt: '4️⃣ Quelle est la **ville ou l\'adresse de votre siège/dépôt** (pour le calcul des trajets) ?'
  },
  {
    key: 'workingHours',
    prompt: '5️⃣ Quels sont vos **horaires de travail habituels** (ex: Du Lundi au Vendredi de 8h à 19h) ?'
  },
  {
    key: 'callPreference',
    prompt: '6️⃣ Quand souhaitez-vous que l\'IA **vous APPELLE directement sur votre téléphone** ?\n\n' +
            '1️⃣ Dès le premier message de n\'importe quel client\n' +
            '2️⃣ Uniquement quand un client **valide une demande d\'intervention / réserve un RDV**\n' +
            '3️⃣ Uniquement en cas d\'urgence absolue (fuite, panne...)\n' +
            '4️⃣ JAMAIS d\'appel (m\'envoyer uniquement des messages WhatsApp)\n\n' +
            '👉 *Répondez 1, 2, 3 ou 4*'
  },
  {
    key: 'emergencyTypes',
    prompt: '7️⃣ Que considérez-vous comme une **URGENCE ABSOLUE** dans votre métier (ex: Fuite d\'eau grave, panne de chauffage en hiver, porte claquée...) ?'
  },
  {
    key: 'pricingPolicy',
    prompt: '8️⃣ Comment l\'IA doit-elle répondre aux clients qui demandent un **tarif ou un devis** ?\n\n' +
            '1️⃣ Ne jamais donner de prix (indiquer que l\'estimation se fait sur place/devis)\n' +
            '2️⃣ Indiquer un tarif de départ à titre indicatif\n' +
            '3️⃣ Préciser que le devis et le déplacement sont gratuits\n\n' +
            '👉 *Répondez 1, 2 ou 3*'
  },
  {
    key: 'botTone',
    prompt: '9️⃣ Quel **ton de voix** doit adopter votre assistant avec vos clients ?\n\n' +
            '1️⃣ Professionnel et formel (Vouvoiement)\n' +
            '2️⃣ Chaleureux et décontracté (Tutoiement)\n\n' +
            '👉 *Répondez 1 ou 2*'
  },
  {
    key: 'locationTrackingActive',
    prompt: '🔟 Souhaitez-vous activer le **suivi GPS intelligent** pour prévenir automatiquement vos clients de vos retards ou embouteillages ? (Répondez Oui ou Non)'
  },
  {
    key: 'customInstructions',
    prompt: '1️⃣1️⃣ Une **consigne spécifique ou règle d\'or** à donner à votre IA ?\n' +
            '*(Exemple : "Ne jamais prendre de RDV le mercredi après-midi", "Préciser qu\'on prend la carte bleue", "Demander une photo du problème").*\n\n' +
            '👉 *Écrivez votre consigne ou tapez "Aucune"*'
  }
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
 * enregistre la valeur, et retourne le prochain message à envoyer.
 */
export async function handleOnboardingReply(tenant, state, sanitizedMessage) {
  const step = STEPS[state.stepIndex];
  const value = normalizeStepValue(step.key, sanitizedMessage);

  // Enregistrement dynamique en BDD
  try {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { [step.key]: value },
    });
  } catch (err) {
    // Si un champ n'existe pas encore dans schema.prisma, on évite un crash
    console.warn(`Champ ${step.key} non pris en compte en BDD ou à ajouter dans schema.prisma`);
  }

  const nextIndex = state.stepIndex + 1;

  // Clôture de l'onboarding si toutes les questions ont été posées
  if (nextIndex >= STEPS.length) {
    await setConversationState(tenant.id, null);
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { onboardingStatus: 'completed' },
    });
    return (
      '🚀 **Félicitations, votre assistant IA est 100% configuré et opérationnel !**\n\n' +
      'Désormais, il répondra à vos clients, prendra vos rendez-vous et vous alertera selon vos préférences.\n\n' +
      '💡 *Astuce : Vous pouvez modifier vos réglages à tout moment par simple message (ex: "Appelle-moi uniquement pour les urgences désormais" ou "Change mes horaires : 8h-18h").*'
    );
  }

  await setConversationState(tenant.id, { flow: 'onboarding', stepIndex: nextIndex });
  return STEPS[nextIndex].prompt;
}

/**
 * Nettoie et formate la valeur saisie par l'artisan selon la question.
 */
function normalizeStepValue(key, rawValue) {
  const text = rawValue.trim();

  if (key === 'locationTrackingActive') {
    return /^(o|oui|y|yes|1)/i.test(text);
  }

  if (key === 'callPreference') {
    if (/^1|premier|tous|toujours/i.test(text)) return 'FIRST_CONTACT';
    if (/^2|intervention|rdv|rendez-vous|reserve|commande/i.test(text)) return 'NEW_BOOKING_ONLY'; // <-- La nouvelle option "commande / validation" !
    if (/^3|urgence/i.test(text)) return 'URGENCY_ONLY';
    if (/^4|jamais|message|whatsapp|texte/i.test(text)) return 'WHATSAPP_ONLY';
    return 'NEW_BOOKING_ONLY'; // Valeur par défaut équilibrée (choix 2)
  }

  if (key === 'pricingPolicy') {
    if (/^2|depart|indicatif/i.test(text)) return 'SHOW_STARTING_PRICE';
    if (/^3|gratuit|devis/i.test(text)) return 'FREE_QUOTE_ON_SITE';
    return 'NO_PRICE_GIVEN'; // Valeur par défaut (choix 1)
  }

  if (key === 'botTone') {
    if (/^2|tuto|chaleureux/i.test(text)) return 'TUTOIEMENT';
    return 'VOUVOIEMENT'; // Valeur par défaut (choix 1)
  }

  return text;
}