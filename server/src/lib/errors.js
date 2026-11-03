export class AppError extends Error {
  constructor(status, code, message, options = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.retryAfter = options.retryAfter;
    this.expose = options.expose ?? true;
  }
}

export class DeepSeekError extends AppError {
  constructor(code, message, options = {}) {
    super(options.status ?? 502, code, message, options);
    this.name = 'DeepSeekError';
    this.upstreamStatus = options.upstreamStatus;
  }
}
