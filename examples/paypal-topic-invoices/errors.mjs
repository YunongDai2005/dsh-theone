export class AppError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message); this.name = 'AppError'; this.code = code; this.status = status; this.details = details;
  }
}
export class PayPalError extends AppError {
  constructor(message, { phase, upstreamStatus, outcome = 'unknown', issue } = {}) {
    super(phase === 'oauth' ? 'PAYPAL_AUTH_FAILED' : outcome !== 'unknown' ? 'PAYPAL_REJECTED' : 'PAYPAL_UNAVAILABLE',
      message, phase === 'oauth' ? 503 : outcome !== 'unknown' ? 422 : 502,
      { phase, upstream_status: upstreamStatus, remote_outcome: outcome, ...(issue ? { issue } : {}) });
    this.outcome = outcome;
  }
}
export function publicError(error) {
  if (error instanceof AppError) return { status: error.status, body: { error: error.message, code: error.code, ...error.details,
    ...(error.attemptId ? { attempt_id: error.attemptId } : {}) } };
  const message = String(error.message ?? 'Request failed');
  const status = /Unknown (proposal|topic)/.test(message) ? 404
    : /Stale|Review changed|immutable|already claimed|pending or uncertain|context changed|still in progress|No creation attempt|Request ID already/.test(message) ? 409
    : /not configured|Configure .* before/.test(message) ? 503
    : error instanceof SyntaxError || /Invalid |Unsupported |Amount must|Sandbox amount|No invoice fields|does not accept|not customer invoices|Revision target|No pending question|Topic limit|Unexpected model plan/.test(message) ? 400 : 500;
  return { status, body: { error: status === 500 ? 'Internal request failure; inspect the local attempt or event history.' : message,
    code: status === 409 ? 'STATE_CONFLICT' : status === 404 ? 'NOT_FOUND' : status === 503 ? 'NOT_CONFIGURED' : status === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST',
    ...(error.attemptId ? { attempt_id: error.attemptId } : {}) } };
}
