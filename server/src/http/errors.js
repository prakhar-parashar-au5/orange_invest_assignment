import { describeError, stackFrames } from '../util/log-error.js';

/** An error the client is allowed to see: a status, a stable code and a safe message. */
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message) => new HttpError(400, 'VALIDATION_ERROR', message);
export const unauthenticated = (message = 'Please log in') => new HttpError(401, 'UNAUTHENTICATED', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'NOT_FOUND', message);

export function sendError(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

/** The 404 handler for unknown routes. */
export function notFoundHandler(_req, res) {
  sendError(res, 404, 'NOT_FOUND', 'Route not found');
}

/**
 * Last middleware. Known errors pass through. Anything else becomes a generic 500. Only the error
 * name and stack are logged, never the request body, which may carry financial data.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) {
    return sendError(res, err.status, err.code, err.message);
  }
  // express.json() failure on a malformed body
  if (err.type === 'entity.parse.failed') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Request body is not valid JSON');
  }
  if (err.type === 'entity.too.large') {
    return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  console.error(`unhandled error: ${describeError(err)}
${stackFrames(err)}`);
  return sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong');
}
