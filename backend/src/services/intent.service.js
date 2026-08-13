// ==========================================================================
// Application des intentions de configuration détectées par l'IA
// (voir openai.service.js#detectSettingsIntent) — Module 1, commandes en
// langage naturel à la volée.
// ==========================================================================
import { updateTenant } from './tenant.service.js';

/**
 * Applique l'intention détectée à la fiche du tenant et retourne un message
 * de confirmation textuel à renvoyer sur WhatsApp à l'artisan.
 * Retourne null si l'intention est "NONE" (aucune action à effectuer).
 */
export async function applySettingsIntent(tenant, { intent, extractedValue }) {
  switch (intent) {
    // ----------------------------------------------------------------------
    // 1. LOCALISATION & GEOGRAPHIE
    // ----------------------------------------------------------------------
    case 'DISABLE_LOCATION_TRACKING':
      await updateTenant(tenant.id, { locationTrackingActive: false });
      return '📍 Localisation désactivée. Je ne surveillerai plus votre position GPS.';

    case 'ENABLE_LOCATION_TRACKING':
      await updateTenant(tenant.id, { locationTrackingActive: true });
      return '📍 Localisation activée. Je surveille désormais votre position pour prévenir vos clients de vos retards.';

    case 'UPDATE_GEOGRAPHIC_ZONE':
      if (!extractedValue) return null;
      await updateTenant(tenant.id, { geographicZone: extractedValue });
      return `✅ Zone d'intervention mise à jour : "${extractedValue}".`;

    case 'UPDATE_BASE_ADDRESS':
      if (!extractedValue) return null;
      await updateTenant(tenant.id, { baseAddress: extractedValue });
      return `📍 Adresse du dépôt/siège mise à jour : "${extractedValue}".`;

    // ----------------------------------------------------------------------
    // 2. HORAIRES & DÉLAIS
    // ----------------------------------------------------------------------
    case 'UPDATE_WORKING_HOURS':
      if (!extractedValue) return null;
      await updateTenant(tenant.id, { workingHours: extractedValue });
      return `🕒 Horaires de travail mis à jour : "${extractedValue}".`;

    // ----------------------------------------------------------------------
    // 3. PRÉFÉRENCES D'APPEL DE L'ARTISAN (Question 6)
    // ----------------------------------------------------------------------
    case 'SET_CALL_PREFERENCE_FIRST_CONTACT':
      await updateTenant(tenant.id, { callPreference: 'FIRST_CONTACT' });
      return '📞 Option enregistrée : Je vous appellerai dès le premier message de chaque nouveau client.';

    case 'SET_CALL_PREFERENCE_NEW_BOOKING':
      await updateTenant(tenant.id, { callPreference: 'NEW_BOOKING_ONLY' });
      return '📞 Option enregistrée : Je vous appellerai uniquement lorsqu\'un client confirme une demande d\'intervention ou réserve un RDV.';

    case 'SET_CALL_PREFERENCE_URGENCY_ONLY':
      await updateTenant(tenant.id, { callPreference: 'URGENCY_ONLY' });
      return '🚨 Option enregistrée : Je vous appellerai uniquement pour les urgences absolues.';

    case 'SET_CALL_PREFERENCE_WHATSAPP_ONLY':
      await updateTenant(tenant.id, { callPreference: 'WHATSAPP_ONLY' });
      return '💬 Option enregistrée : Aucun appel. Tous les messages et alertes vous seront envoyés directement sur WhatsApp.';

    // ----------------------------------------------------------------------
    // 4. DÉFINITION DES URGENCES & CONSIGNES
    // ----------------------------------------------------------------------
    case 'UPDATE_EMERGENCY_TYPES':
      if (!extractedValue) return null;
      await updateTenant(tenant.id, { emergencyTypes: extractedValue });
      return `🚨 Liste des urgences mise à jour : "${extractedValue}".`;

    case 'UPDATE_CUSTOM_INSTRUCTIONS':
      if (!extractedValue) return null;
      await updateTenant(tenant.id, { customInstructions: extractedValue });
      return `📝 Consigne particulière mise à jour : "${extractedValue}".`;

    // ----------------------------------------------------------------------
    // 5. POLITIQUE DE PRIX (Question 8)
    // ----------------------------------------------------------------------
    case 'SET_PRICING_NO_PRICE':
      await updateTenant(tenant.id, { pricingPolicy: 'NO_PRICE_GIVEN' });
      return '💶 Politique tarifaire mise à jour : Je ne donnerai aucun prix par message et proposerai une étude sur place/devis.';

    case 'SET_PRICING_SHOW_STARTING':
      await updateTenant(tenant.id, { pricingPolicy: 'SHOW_STARTING_PRICE' });
      return '💶 Politique tarifaire mise à jour : Je donnerai vos tarifs de départ à titre indicatif.';

    case 'SET_PRICING_FREE_QUOTE':
      await updateTenant(tenant.id, { pricingPolicy: 'FREE_QUOTE_ON_SITE' });
      return '💶 Politique tarifaire mise à jour : Indication que le devis et le déplacement sont 100% gratuits.';

    // ----------------------------------------------------------------------
    // 6. TON DU BOT (Question 9)
    // ----------------------------------------------------------------------
    case 'SET_BOT_TONE_VOUVOIEMENT':
      await updateTenant(tenant.id, { botTone: 'VOUVOIEMENT' });
      return '🗣️ Ton de voix mis à jour : Je vouvoierai désormais tous vos clients.';

    case 'SET_BOT_TONE_TUTOIEMENT':
      await updateTenant(tenant.id, { botTone: 'TUTOIEMENT' });
      return '🗣️ Ton de voix mis à jour : Je tutoierai désormais tous vos clients.';

    // ----------------------------------------------------------------------
    // 7. IDENTITÉ & ANCIENNES NOTIFICATIONS
    // ----------------------------------------------------------------------
    case 'UPDATE_COMPANY_NAME':
      if (!extractedValue) return null;
      await updateTenant(tenant.id, { companyName: extractedValue });
      return `✅ Nom d'entreprise mis à jour : "${extractedValue}".`;

    case 'UPDATE_ACTIVITY_TYPE':
      if (!extractedValue) return null;
      await updateTenant(tenant.id, { activityType: extractedValue });
      return `✅ Activité mise à jour : "${extractedValue}".`;

    case 'SET_NOTIFICATION_TEXT':
      await updateTenant(tenant.id, { notificationPreference: 'text' });
      return '💬 Mode notification texte activé.';

    case 'SET_NOTIFICATION_VOICE':
      await updateTenant(tenant.id, { notificationPreference: 'voice' });
      return '🔊 Mode notification vocale activé.';

    case 'NONE':
    default:
      return null;
  }
}