// Distinguishable error codes. Bodies are fixed strings: they never echo document
// content, request fields, upstream messages or credentials.

export const ERRORS = {
  not_found: { status: 404, message: 'Not found.', retryable: false },
  unauthorized: { status: 401, message: 'Not authorised.', retryable: false },
  method_not_allowed: { status: 405, message: 'Method not allowed.', retryable: false },
  origin_denied: { status: 403, message: 'Origin not allowed.', retryable: false },
  invalid_input: { status: 400, message: 'Request is invalid.', retryable: false },
  too_large: { status: 413, message: 'Request exceeds the allowed size.', retryable: false },
  rate_limited: { status: 429, message: 'Too many requests. Try again shortly.', retryable: true },
  daily_limit: { status: 429, message: 'The daily analysis allowance has been used. Try again after 00:00 UTC.', retryable: true },
  run_exceeds_allowance: { status: 429, message: "This analysis is larger than what is left of today's allowance. Nothing was sent.", retryable: true },
  run_busy: { status: 429, message: 'Other analyses are running. Try again in a few minutes. Nothing was sent.', retryable: true },
  run_expired: { status: 410, message: 'This analysis session has ended. Start the analysis again.', retryable: false },
  quota_exhausted: { status: 503, message: 'The AI service quota is exhausted. Analysis is temporarily unavailable.', retryable: true },
  model_unavailable: { status: 503, message: 'The AI service is temporarily unavailable.', retryable: true },
  timeout: { status: 504, message: 'The AI service did not respond in time. The attempt may still count against the allowance.', retryable: true },
  schema_invalid: { status: 502, message: 'The AI service returned an unusable response.', retryable: true },
  limiter_unavailable: { status: 503, message: 'Usage control is unavailable. Analysis is closed until it recovers.', retryable: true },
  not_configured: { status: 503, message: 'The service is not configured.', retryable: false },
  internal_error: { status: 500, message: 'Internal error.', retryable: false },
} as const;

export type ErrorCode = keyof typeof ERRORS;
