// ==========================================================================
// Authentification des routes back-office/admin (hors webhooks).
// Simple Bearer token JWT signé avec JWT_SECRET — à étendre selon besoins
// (rôles, expiration courte, refresh tokens…).
// ==========================================================================
import jwt from 'jsonwebtoken';

export function requireAdminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentification requise.' });
  }

  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }
}
