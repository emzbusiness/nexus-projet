// ==========================================================================
// Service Google — publication sur Google Business Profile (posts SEO,
// réponses aux avis) + récupération des avis clients.
// Les tokens OAuth sont stockés chiffrés en base (voir config/security.js)
// et déchiffrés uniquement au moment de l'appel API.
// ==========================================================================
import axios from 'axios';
import { decryptSecret } from '../config/security.js';
import { logger } from '../utils/logger.js';

const GOOGLE_BUSINESS_API_BASE = 'https://mybusiness.googleapis.com/v4';

function buildAuthHeader(tenant) {
  const accessToken = decryptSecret(tenant.googleBusinessToken);
  return { Authorization: `Bearer ${accessToken}` };
}

/**
 * Publie un post SEO généré par l'IA sur la fiche Google Business Profile
 * de l'artisan (Module 2).
 */
export async function publishBusinessProfilePost(tenant, { summaryText, imageUrl }) {
  if (!tenant.googleBusinessToken || !tenant.googleBusinessLocationId) {
    logger.warn({ tenantId: tenant.id }, 'Google Business Profile non connecté — publication ignorée.');
    return null;
  }

  const url = `${GOOGLE_BUSINESS_API_BASE}/${tenant.googleBusinessLocationId}/localPosts`;

  const response = await axios.post(
    url,
    {
      languageCode: 'fr',
      summary: summaryText,
      media: imageUrl ? [{ mediaFormat: 'PHOTO', sourceUrl: imageUrl }] : undefined,
      topicType: 'STANDARD',
    },
    { headers: buildAuthHeader(tenant) }
  );

  return response.data;
}

/**
 * Récupère les avis Google les plus récents pour la fiche du tenant.
 */
export async function fetchRecentReviews(tenant) {
  if (!tenant.googleBusinessToken || !tenant.googleBusinessLocationId) return [];

  const url = `${GOOGLE_BUSINESS_API_BASE}/${tenant.googleBusinessLocationId}/reviews`;
  const response = await axios.get(url, { headers: buildAuthHeader(tenant) });
  return response.data.reviews || [];
}

/**
 * Publie la réponse (validée par l'artisan) à un avis Google.
 */
export async function publishReviewReply(tenant, googleReviewId, replyText) {
  const url = `${GOOGLE_BUSINESS_API_BASE}/${tenant.googleBusinessLocationId}/reviews/${googleReviewId}/reply`;
  const response = await axios.put(url, { comment: replyText }, { headers: buildAuthHeader(tenant) });
  return response.data;
}
