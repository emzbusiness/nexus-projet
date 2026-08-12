// ==========================================================================
// Agrégation des routes de l'application.
// - /webhooks/*  : entrées Twilio/Meta/Stripe (protégées par signature +
//                  rate limiting spécifique — montées dans server.js)
// - /api/*       : routes internes back-office (protégées par JWT admin)
// - /healthz     : sonde de santé publique (aucune donnée sensible)
// ==========================================================================
import { Router } from 'express';
import { requireAdminAuth } from '../middlewares/auth.middleware.js';
import { prisma } from '../config/database.js';
import { updateTenantLocation } from '../jobs/locationTracker.job.js';

export const apiRouter = Router();

apiRouter.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Routes back-office (protégées) --------------------------------------
apiRouter.get('/api/tenants', requireAdminAuth, async (req, res) => {
  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      companyName: true,
      whatsappPhoneNumber: true,
      subscriptionBadge: true,
      onboardingStatus: true,
    },
  });
  res.json(tenants);
});

// --- Endpoint interne de mise à jour GPS (ex: app mobile compagnon) -------
// Protégé par JWT admin ici à titre d'exemple ; en production, préférer un
// token dédié par tenant (scope limité) plutôt que le JWT admin global.
apiRouter.post('/api/tenants/:tenantId/location', requireAdminAuth, async (req, res) => {
  const { lat, lng } = req.body;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat et lng doivent être des nombres.' });
  }
  const updated = await updateTenantLocation(req.params.tenantId, { lat, lng });
  res.json({ ok: true, tenantId: updated.id });
});
