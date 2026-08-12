// ==========================================================================
// Service de géolocalisation — calcul de trajet via Google Directions API
// et détection de retard imminent (Module 4, réservé au badge PREMIUM).
// ==========================================================================
import axios from 'axios';
import { logger } from '../utils/logger.js';

const DIRECTIONS_API_URL = 'https://maps.googleapis.com/maps/api/directions/json';

/**
 * Calcule le temps de trajet actuel (avec trafic en temps réel) entre la
 * position courante de l'artisan et l'adresse du prochain RDV.
 * Retourne la durée en minutes (arrondie).
 */
export async function computeTravelTimeMinutes({ originLat, originLng, destinationAddress }) {
  const response = await axios.get(DIRECTIONS_API_URL, {
    params: {
      origin: `${originLat},${originLng}`,
      destination: destinationAddress,
      departure_time: 'now',
      traffic_model: 'best_guess',
      key: process.env.GOOGLE_MAPS_API_KEY,
    },
  });

  const route = response.data?.routes?.[0]?.legs?.[0];
  if (!route) {
    logger.warn({ destinationAddress }, 'Aucun itinéraire trouvé par Google Directions.');
    return null;
  }

  const durationSeconds = route.duration_in_traffic?.value ?? route.duration?.value;
  return Math.round(durationSeconds / 60);
}

/**
 * Détermine si l'artisan risque d'être en retard : compare le temps de
 * trajet actuel (avec trafic) au temps restant avant l'heure du RDV.
 * Une marge de sécurité (bufferMinutes) déclenche l'alerte un peu avant
 * l'heure fatidique pour laisser le temps de réagir.
 */
export function isDelayImminent({ scheduledAt, travelMinutes, bufferMinutes = 10 }) {
  const now = new Date();
  const minutesUntilAppointment = (new Date(scheduledAt).getTime() - now.getTime()) / 60000;
  return minutesUntilAppointment - travelMinutes < bufferMinutes;
}

/**
 * Calcule la nouvelle heure d'arrivée estimée (ETA) à partir du temps de
 * trajet recalculé — utilisé pour informer poliment le client final.
 */
export function computeRecalculatedEta(travelMinutes) {
  return new Date(Date.now() + travelMinutes * 60000);
}
