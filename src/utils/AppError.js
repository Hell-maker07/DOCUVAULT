/** Operational error that the central error handler turns into the JSON error envelope. */
export default class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL', details = []) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
