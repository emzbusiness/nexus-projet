// ==========================================================================
// SERVER.JS — Point d'entrée principal du SaaS multi-tenant.
//
// Ordre d'assemblage volontairement explicite :
//   1) Chargement des variables d'environnement + validation fail-fast.
//   2) Sécurité HTTP globale (helmet).
//   3) Parsing du corps des requêtes — ATTENTION : Stripe et Meta exigent
//      le corps BRUT pour valider leur signature. On capture donc rawBody
//      via le "verify" callback d'express AVANT le parsing JSON, pour
//      toutes les routes, sans casser le comportement standard ailleurs.
//   4) Rate limiting global puis spécifique aux webhooks.
//   5) Montage des routes (webhooks protégés par signature, API interne).
//      + Route Chatbot Vitrine (Nexus Pro)
//   6) Jobs de fond (GPS, avis).
//   7) Gestion d'erreurs + démarrage.
// ==========================================================================
import 'dotenv/config';
import express from 'express';
import { assertEnvironment } from './src/config/security.js';
import { connectDatabase } from './src/config/database.js';
import { helmetMiddleware, errorHandler, notFoundHandler } from './src/middlewares/security.middleware.js';
import { globalRateLimiter, webhookRateLimiter, paymentWebhookRateLimiter } from './src/middlewares/rateLimiter.middleware.js';
import { verifyTwilioSignature } from './src/middlewares/twilioSignature.middleware.js';
import { metaWebhookVerificationHandler } from './src/middlewares/metaSignature.middleware.js';
import { whatsappWebhookRouter } from './src/webhooks/whatsapp.webhook.js';
import { twilioVoiceWebhookRouter } from './src/webhooks/twilio-voice.webhook.js';
import { stripeWebhookRouter } from './src/webhooks/stripe.webhook.js';
import { apiRouter } from './src/routes/index.js';
import { startLocationTrackerJob } from './src/jobs/locationTracker.job.js';
import { startReviewRequestJob } from './src/jobs/reviewRequest.job.js';
import { startReviewValidationJob } from './src/jobs/reviewValidation.job.js';
import { logger } from './src/utils/logger.js';
import path from 'path';

// --- 1) Validation des secrets au démarrage (fail-fast) -------------------
assertEnvironment();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(express.static(path.join(process.cwd(), '../frontend')));

app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), '../frontend', 'index.html'));
});

// --- Configuration Google Gemini ---
// On initialise l'IA avec ta clé API récupérée dans les variables d'environnement
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- 2) Sécurité HTTP globale ----------------------------------------------
app.use(helmetMiddleware);

// --- 3) Parsing avec capture du corps brut (nécessaire aux signatures) ----
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: false }));

// --- 4) Rate limiting global -----------------------------------------------
app.use(globalRateLimiter);

// --- 5) Routes ---------------------------------------------------------------

// Webhook Stripe
app.use('/webhooks', paymentWebhookRateLimiter, stripeWebhookRouter);

// Vérification initiale du webhook Meta
app.get('/webhooks/whatsapp-meta', metaWebhookVerificationHandler);

// Webhooks WhatsApp (Twilio) + Voice
app.use(
  ['/webhooks/whatsapp', '/webhooks/twilio-voice', '/webhooks/twilio-voice/say'],
  webhookRateLimiter,
  verifyTwilioSignature
);
app.use('/webhooks', whatsappWebhookRouter, twilioVoiceWebhookRouter);

// --------------------------------------------------------------------------
// --- 5.bis) ROUTE CHATBOT VITRINE (NEXUS PRO) -----------------------------
// --------------------------------------------------------------------------
app.post('/api/chat', async (req, res) => {
  try {
    const userMessage = req.body.message;

    if (!userMessage) {
      return res.status(400).json({ error: "Le message est vide." });
    }

    // C'est ICI que tu définis le comportement de ton bot de vente !
    const systemInstruction = `
      Tu es l'Expert Nexus, l'assistant virtuel officiel du site Nexus Pro.
      Ton rôle est d'accueillir les visiteurs (principalement des artisans, plombiers, électriciens, etc.) 
      et de répondre à leurs questions sur nos services d'automatisation.

      NOS 3 OFFRES :
      1. Essentiel (99€/mois) : Secrétariat WhatsApp automatisé 24/7, gestion et relance des avis Google, prise de rendez-vous automatique.
      2. Premium (149€/mois) : Tout ce qui est dans Essentiel + Assistant trajet & suivi GPS en temps réel, alertes de ponctualité pour les clients, agenda intelligent optimisé par trajet.
      3. Premium + Web (169€/mois) : Tout ce qui est dans Premium + Création et gestion complète de leur site internet de A à Z avec optimisation SEO Google.

      TES RÈGLES DE COMPORTEMENT :
      - Ton ton doit être professionnel, chaleureux, rassurant et dynamique.
      - Sois concis : fais des réponses courtes et aérées (utilise des emojis avec modération). Les utilisateurs lisent dans une petite fenêtre de chat.
      - Vouvoie toujours le visiteur, sauf s'il te tutoie en premier.
      - Si le visiteur demande comment s'inscrire, dis-lui de cliquer sur les boutons verts "S'abonner" sur la page.
      - Si une question est trop technique ou hors de ton champ de compétence, invite le visiteur à nous contacter à contact.nexuspro.bot@gmail.com.
      - Ne génère jamais de code informatique et ne réponds à aucune question qui n'a pas de rapport avec l'artisanat ou Nexus Pro.
    `;

    // Utilisation du modèle flash (parfait pour le chat : ultra rapide et pas cher)
    const model = genAI.getGenerativeModel({ 
      model: "gemini-3.1-flash-lite",
      systemInstruction: systemInstruction 
    });

    const result = await model.generateContent(userMessage);
    const responseText = result.response.text();

    // On renvoie la réponse au frontend
    res.json({ reply: responseText });

  } catch (error) {
    logger.error({ err: error }, '❌ Erreur route /api/chat (Gemini)');
    res.status(500).json({ 
      error: "Une erreur est survenue en contactant l'Expert Nexus. Réessaie dans un instant, ou écris-nous directement à contact.nexuspro.bot@gmail.com." 
    });
  }
});
// --------------------------------------------------------------------------

// Routes API internes / santé.
app.use('/', apiRouter);

// --- 6) Gestion d'erreurs (toujours en dernier) ----------------------------
app.use(notFoundHandler);
app.use(errorHandler);

// --- 7) Démarrage --------------------------------------------------------
const PORT = process.env.PORT || 3000;

async function start() {
  await connectDatabase();

  app.listen(PORT, () => {
    logger.info(`🚀 Serveur SaaS Artisan démarré sur le port ${PORT} (env: ${process.env.NODE_ENV}).`);
  });

  startLocationTrackerJob();
  startReviewRequestJob();
  startReviewValidationJob();
}

start().catch((err) => {
  logger.fatal({ err }, '❌ Échec du démarrage du serveur.');
  process.exit(1);
});

export default app;
