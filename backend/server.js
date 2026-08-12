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

// --- 1) Validation des secrets au démarrage (fail-fast) -------------------
assertEnvironment();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // nécessaire derrière un proxy/tunnel (ngrok, load balancer) pour un rate-limit par IP correct

// --- 2) Sécurité HTTP globale ----------------------------------------------
app.use(helmetMiddleware);

// --- 3) Parsing avec capture du corps brut (nécessaire aux signatures) ----
// express.json({verify}) : capture req.rawBody AVANT que express ne
// remplace req.body par l'objet JSON parsé — indispensable pour Meta.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
// Twilio envoie du x-www-form-urlencoded pour ses webhooks (WhatsApp/Voice).
app.use(express.urlencoded({ extended: false }));

// --- 4) Rate limiting global -----------------------------------------------
app.use(globalRateLimiter);

// --- 5) Routes ---------------------------------------------------------------

// Webhook Stripe : le corps brut est déjà capturé dans req.rawBody par le
// callback "verify" de express.json() ci-dessus — réutilisé directement
// dans stripe.webhook.js pour valider la signature. Montage sur un chemin
// dédié et isolé (rate limiter propre aux paiements).
app.use('/webhooks', paymentWebhookRateLimiter, stripeWebhookRouter);

// Vérification initiale du webhook Meta (handshake GET, hors signature).
app.get('/webhooks/whatsapp-meta', metaWebhookVerificationHandler);

// Webhooks WhatsApp (Twilio) + Voice : signature Twilio obligatoire.
// Montés sur des chemins strictement différents de /webhooks/stripe afin
// que chaque route ne subisse que le rate limiter et le contrôle de
// signature qui lui sont propres.
app.use(
  ['/webhooks/whatsapp', '/webhooks/twilio-voice', '/webhooks/twilio-voice/say'],
  webhookRateLimiter,
  verifyTwilioSignature
);
app.use('/webhooks', whatsappWebhookRouter, twilioVoiceWebhookRouter);

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
