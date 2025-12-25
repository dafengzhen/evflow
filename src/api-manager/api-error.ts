import type { ApiRequest, ApiResponse } from './types.ts';

/**
 * ApiError.
 *
 * @author dafengzhen
 */
export class ApiError extends Error {
  public cause?: unknown;
  public code: string;
  public request?: ApiRequest;
  public response?: ApiResponse;
  public status?: number;

  constructor(
    message: {
      [key: string]: unknown
      cause?: unknown,
      code: string,
      request?: ApiRequest,
      response?: ApiResponse,
      status?: number,
    }
  ) {
    super(message.code);
    this.code = message.code;
    this.request = message.request;
    this.response = message.response;
    this.status = message.status;
    this.cause = message.cause;
  }
}
