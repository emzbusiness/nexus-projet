// ==========================================================================
// Application des intentions de configuration détectées par l'IA
// (voir openai.service.js#detectSettingsIntent) — Module 1, commandes en
// langage naturel à la volée.
// ==========================================================================
import { updateTenant } from './tenant.service.js';

/**
 * Applique l'intention détectée à la fiche du tenant et retourne un message
 * de confirmation textuel à renvoyer sur WhatsApp.
 * Retourne null si l'intention est "NONE" (aucune action à effectuer).
 */
export async function applySettingsIntent(tenant, { intent, extractedValue }) {
  switch (intent) {
    case 'DISABLE_LOCATION_TRACKING':
      await updateTenant(tenant.id, { locationTrackingActive: false });
      return '📍 Localisation désactivée. Je ne surveillerai plus votre position.';

    case 'ENABLE_LOCATION_TRACKING':
      await updateTenant(tenant.id, { locationTrackingActive: true });
      return '📍 Localisation activée. Je surveille désormais votre position pour anticiper vos retards.';

    case 'SET_NOTIFICATION_TEXT':
      await updateTenant(tenant.id, { notificationPreference: 'text' });
      return '💬 Mode notification texte activé.';

    case 'SET_NOTIFICATION_VOICE':
      await updateTenant(tenant.id, { notificationPreference: 'voice' });
      return '🔊 Mode notification vocale activé.';

    case 'UPDATE_COMPANY_NAME':
      if (!extractedValue) return null;
      await updateTenant(tenant.id, { companyName: extractedValue });
      return `✅ Nom d'entreprise mis à jour : "${extractedValue}".`;

    case 'UPDATE_ACTIVITY_TYPE':
      if (!extractedValue) return null;
      await updateTenant(tenant.id, { activityType: extractedValue });
      return `✅ Activité mise à jour : "${extractedValue}".`;

    case 'UPDATE_GEOGRAPHIC_ZONE':
      if (!extractedValue) return null;
      await updateTenant(tenant.id, { geographicZone: extractedValue });
      return `✅ Zone géographique mise à jour : "${extractedValue}".`;

    case 'NONE':
    default:
      return null;
  }
}
