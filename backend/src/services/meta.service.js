import axios from 'axios';
import { logger } from '../utils/logger.js';

export async function sendWhatsAppMessage(toPhoneNumber, messageText) {
  const token = process.env.META_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

  // Si les clés Meta ne sont pas configurées, on simule l'envoi (Mode Blanc)
  if (!token || !phoneNumberId || token === 'placeholder') {
    logger.info(`[MODE BLANC - META] Message simulé vers ${toPhoneNumber} : "${messageText}"`);
    return;
  }

  try {
    const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      to: toPhoneNumber,
      type: 'text',
      text: { body: messageText }
    };

    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    logger.info(`Message Meta envoyé avec succès à ${toPhoneNumber}`);
    return response.data;
  } catch (error) {
    logger.error({ err: error.response?.data || error.message }, 'Erreur lors de l\'envoi du message via Meta');
  }
}