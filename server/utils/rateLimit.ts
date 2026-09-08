import { NextFunction, Request, Response } from 'express';

/**
 * Fixed-window, in-memory rate limiter.
 *
 * In-memory is the correct scope here: the app runs as a single free-tier
 * instance, so there is no second process to share counters with. If it ever
 * scales horizontally this needs to move to a shared store.
 */

const WINDOW_MS = Number(process.env.CHAT_RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000);
const MAX_REQUESTS = Number(process.env.CHAT_RATE_LIMIT_MAX ?? 30);

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

function clientKey(req: Request): string {
    // Render sits behind a proxy, so the socket address is the load balancer.
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.ip ?? 'unknown';
}

/** Drop expired windows so the map cannot grow without bound. */
function sweep(now: number): void {
    for (const [key, window] of windows) {
        if (window.resetAt <= now) windows.delete(key);
    }
}

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    if (windows.size > 1000) sweep(now);

    const key = clientKey(req);
    const window = windows.get(key);

    if (!window || window.resetAt <= now) {
        windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
        next();
        return;
    }

    window.count += 1;

    if (window.count > MAX_REQUESTS) {
        const retryAfter = Math.ceil((window.resetAt - now) / 1000);
        res.setHeader('Retry-After', String(retryAfter));
        res.status(429).json({
            error: 'Slow down a moment — too many questions in a short time. Try again shortly.',
        });
        return;
    }

    next();
}
