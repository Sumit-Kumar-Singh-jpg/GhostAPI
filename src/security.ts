import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response, NextFunction } from 'express';

type Session = { expires: number };
type AccessOptions = { publicOrigin?: string; password?: string; production: boolean };
export function validateAccessOptions(options: AccessOptions) {
  if (options.production && (!options.password || options.password.length < 16))
    throw new Error('Production requires ADMIN_PASSWORD with at least 16 characters.');
  if (options.production && (!options.publicOrigin || !options.publicOrigin.startsWith('https://')))
    throw new Error('Production requires an HTTPS PUBLIC_ORIGIN.');
  if (options.publicOrigin) {
    const url = new URL(options.publicOrigin);
    if (url.origin !== options.publicOrigin || url.username || url.password)
      throw new Error('PUBLIC_ORIGIN must be a canonical origin without path or credentials.');
  }
}
export function installAccessControl(app: Express, options: AccessOptions) {
  validateAccessOptions(options);
  const protectedMode = options.production || Boolean(options.password);
  const salt = randomBytes(16),
    expected = options.password ? scryptSync(options.password, salt, 32) : undefined;
  const sessions = new Map<string, Session>(),
    attempts = new Map<string, { count: number; until: number }>();
  const digest = (token: string) => createHash('sha256').update(token).digest('hex');
  const cookieName = options.production ? '__Host-ghostapi_session' : 'ghostapi_session';
  const cookie = (req: Request) =>
    req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1) ?? '';
  const authenticated = (req: Request) =>
    !protectedMode || (sessions.get(digest(cookie(req)))?.expires ?? 0) > Date.now();
  app.get('/api/session', (req, res) =>
    res.json({ protected: protectedMode, authenticated: authenticated(req) }),
  );
  app.post('/api/login', (req, res) => {
    if (!protectedMode) {
      res.json({ ok: true });
      return;
    }
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const previous = attempts.get(ip);
    if (previous && previous.until > Date.now() && previous.count >= 5) {
      res.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' });
      return;
    }
    const password = req.body?.password;
    const valid =
      typeof password === 'string' &&
      password.length <= 256 &&
      expected &&
      timingSafeEqual(scryptSync(password, salt, 32), expected);
    if (!valid) {
      const current =
        previous && previous.until > Date.now()
          ? previous
          : { count: 0, until: Date.now() + 15 * 60000 };
      current.count++;
      attempts.set(ip, current);
      res.status(401).json({ error: 'Incorrect administrator password.' });
      return;
    }
    attempts.delete(ip);
    for (const [key, session] of sessions) if (session.expires < Date.now()) sessions.delete(key);
    if (sessions.size >= 1000) {
      res.status(429).json({ error: 'Session capacity reached.' });
      return;
    }
    const token = randomBytes(32).toString('base64url'),
      expires = Date.now() + 8 * 60 * 60000;
    sessions.set(digest(token), { expires });
    res.cookie(cookieName, token, {
      httpOnly: true,
      secure: options.production,
      sameSite: 'strict',
      path: '/',
      maxAge: 8 * 60 * 60000,
    });
    res.json({ ok: true });
  });
  app.post('/api/logout', (req, res) => {
    sessions.delete(digest(cookie(req)));
    res.clearCookie(cookieName, {
      httpOnly: true,
      secure: options.production,
      sameSite: 'strict',
      path: '/',
    });
    res.json({ ok: true });
  });
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (!authenticated(req)) {
      res.status(401).json({ error: 'Administrator sign-in required.' });
      return;
    }
    next();
  });
}
