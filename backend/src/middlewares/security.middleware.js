// ==========================================================================
// Middlewares de sécurité applicative transverses (helmet + capture du
// raw body nécessaire à la vérification de signature Stripe/Twilio).
// ==========================================================================
import helmet from 'helmet';

/**
 * Helmet : en-têtes HTTP durcis (CSP, X-Frame-Options, HSTS, etc.)
 * Appliqué globalement dans server.js.
 */
export const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      objectSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
});

/**
 * Middleware générique de gestion d'erreurs (fin de chaîne Express).
 * Ne renvoie JAMAIS la stack trace ou les détails internes au client
 * (prévention de fuite d'information).
 */
export function errorHandler(err, req, res, _next) {
  req.log?.error({ err }, 'Erreur non gérée');
  const status = err.statusCode || 500;
  res.status(status).json({
    error: status === 500 ? 'Erreur interne du serveur.' : err.message,
  });
}

/**
 * 404 par défaut — évite de révéler la structure des routes internes.
 */
export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Ressource introuvable.' });
}
