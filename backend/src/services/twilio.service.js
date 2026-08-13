// services/twilio.service.js
import twilio from 'twilio';

// Fonction d'appel sortant prête à être activée avec de vrais crédits
export async function makeOutboundCall(toPhoneNumber, messageText) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioNumber = process.env.TWILIO_PHONE_NUMBER; // Ton futur numéro d'appel

  // Si les clés ne sont pas configurées (mode gratuit), on log juste un avertissement
  if (!accountSid || !authToken || accountSid === 'placeholder') {
    console.log(`[MODE BLANC] Appel simulé vers ${toPhoneNumber} : "${messageText}"`);
    return;
  }

  const client = twilio(accountSid, authToken);

  try {
    // Utilisation de TwiML en ligne pour faire parler Twilio lors du décroché
    const twiml = `<Response><Say language="fr-FR">${messageText}</Say></Response>`;
    
    await client.calls.create({
      twiml: twiml,
      to: toPhoneNumber,
      from: twilioNumber,
    });
    console.log(`Appel vocal Twilio déclenché avec succès vers ${toPhoneNumber}`);
  } catch (error) {
    console.error('Erreur lors du déclenchement de l\'appel Twilio :', error);
  }
}