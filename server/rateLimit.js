import rateLimit from 'express-rate-limit';

/*
 * Per-category limiters. Always a factory, never a shared instance: each call
 * gets its own counter, so one form's traffic never eats another's budget.
 * The default in-memory store is right for a single-process app; pass
 * `store` for anything that runs more than one instance.
 */
export function createLimiter({ minutes = 15, limit, message = 'Too many requests. Please try again later.', ...rest }) {
  return rateLimit({
    windowMs: minutes * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
    ...rest,
  });
}

/** Public form posts (contact, lead, signup): enough for a person, tight for a bot. */
export const createFormLimiter = (o = {}) =>
  createLimiter({ limit: 5, message: 'Too many submissions from this device. Please try again later.', ...o });

/** Anything that spends money per call (AI, SMS, paid APIs): a ceiling on a UI loop becoming a bill. */
export const createCostLimiter = (o = {}) =>
  createLimiter({ minutes: 60, limit: 20, message: 'Too many requests this hour. Please try again later.', ...o });
