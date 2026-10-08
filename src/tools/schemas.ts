/**
 * Shared Zod argument schemas. Models often send numbers and booleans as strings
 * ("10", "true"), so those are coerced instead of rejected.
 */

import { z } from 'zod';

export const intArg = () => z.coerce.number().int();

export const boolArg = () =>
  z.preprocess((value) => (value === 'true' ? true : value === 'false' ? false : value), z.boolean());

export const textArg = () => z.string().trim().min(1, 'must not be empty');
