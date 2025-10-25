import type { Request, Response, NextFunction } from 'express';

const sessions = new Map<string, { userId: number; createdAt: number }>();
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;

export function generateSessionId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export function createSession(userId: number): string {
  const sessionId = generateSessionId();
  sessions.set(sessionId, {
    userId,
    createdAt: Date.now(),
  });
  return sessionId;
}

export function getSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  
  if (Date.now() - session.createdAt > SESSION_DURATION) {
    sessions.delete(sessionId);
    return null;
  }
  
  return session;
}

export function deleteSession(sessionId: string) {
  sessions.delete(sessionId);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sessionId = req.cookies.sessionId;
  
  if (!sessionId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const session = getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: 'Session expired' });
  }
  
  (req as any).userId = session.userId;
  next();
}
