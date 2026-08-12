// ==========================================================================
// Connexion unique à la base PostgreSQL via Prisma (pattern singleton).
// Toutes les requêtes multi-tenant passent par ce client : chaque requête
// DOIT filtrer explicitement par tenantId pour garantir l'isolation logique
// des données entre entreprises clientes.
// ==========================================================================
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma;
}

export async function connectDatabase() {
  await prisma.$connect();
  logger.info('✅ Connexion PostgreSQL (Prisma) établie.');
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
}
