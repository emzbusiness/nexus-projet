// ==========================================================================
// WEBHOOK TWILIO VOICE — sert le TwiML des appels vocaux automatisés
// déclenchés par le module d'alerte proactive de retard (Module 4, premium).
// Protégé par verifyTwilioSignature() dans server.js.
// ==========================================================================
import { Router } from 'express';
import { buildSayTwiml } from '../services/twilio.service.js';

export const twilioVoiceWebhookRouter = Router();

twilioVoiceWebhookRouter.post('/twilio-voice/say', (req, res) => {
  const message = req.query.message || 'Bonjour, ceci est une alerte automatique de votre assistant.';
  res.type('text/xml').send(buildSayTwiml(message));
});

// Endpoint de fallback si un appel entrant (non sortant) arrive sur le
// numéro voice (ex: rappel d'un client final) — comportement neutre.
twilioVoiceWebhookRouter.post('/twilio-voice', (req, res) => {
  res.type('text/xml').send(
    buildSayTwiml('Merci de votre appel. Vous serez recontacté au plus vite par notre équipe.')
  );
});
