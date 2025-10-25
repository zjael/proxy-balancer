import type { Response } from '../types/index.js';

/**
 * Custom error class for HTTP response errors
 */
export class ResponseError extends Error {
  public readonly response: Response;

  constructor(message = '', response: Response) {
    super(message);
    this.name = 'ResponseError';
    this.message = message;
    this.response = response;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ResponseError);
    }
  }
}
