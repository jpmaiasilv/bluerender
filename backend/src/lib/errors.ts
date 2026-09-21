import { ErrorCode, JobErrorPayload } from '../types/api';

export class AppError extends Error {
  code: ErrorCode;
  details?: string;
  httpStatus: number;

  constructor(code: ErrorCode, message: string, details?: string, httpStatus = 500) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.httpStatus = httpStatus;
  }

  toPayload(): JobErrorPayload {
    return { code: this.code, message: this.message, details: this.details };
  }
}
