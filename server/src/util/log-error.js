// Errors in logs: class, HTTP status and code only. Never the message, because provider messages
// can echo secrets (OpenAI's 401 includes a masked API key) and DB messages can echo data.

const SAFE_TOKEN = /^[A-Za-z0-9_.-]{1,64}$/;

export function describeError(err) {
  if (!err || typeof err !== 'object') return 'UnknownError';
  const parts = [SAFE_TOKEN.test(err.name ?? '') ? err.name : 'Error'];
  if (Number.isInteger(err.status)) parts.push(`status=${err.status}`);
  if (typeof err.code === 'string' && SAFE_TOKEN.test(err.code)) parts.push(`code=${err.code}`);
  return parts.join(' ');
}

/** Stack frames without the first line, which repeats the message. */
export function stackFrames(err) {
  return String(err?.stack ?? '')
    .split('\n')
    .slice(1, 6)
    .join('\n');
}
