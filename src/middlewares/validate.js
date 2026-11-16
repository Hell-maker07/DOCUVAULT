/**
 * Middleware factory to validate request data against a Zod schema.
 * Replaces req[source] with the parsed/transformed result.
 *
 * @param {import('zod').ZodTypeAny} schema
 * @param {'body'|'query'|'params'} [source='body']
 */
export const validate =
  (schema, source = 'body') =>
  (req, _res, next) => {
    try {
      const parsed = schema.parse(req[source]);
      req[source] = parsed;
      next();
    } catch (err) {
      next(err);
    }
  };
