import { inspect } from 'node:util';

class BackendError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = code;
    this.code = code;
  }
}

class ValidationError extends BackendError {
  constructor(message: string, options?: ErrorOptions) {
    super('ValidationError', message, options);
  }
}

class CliMissingError extends BackendError {
  constructor(message: string, options?: ErrorOptions) {
    super('CliMissingError', message, options);
  }
}

class CliAuthError extends BackendError {
  constructor(message: string, options?: ErrorOptions) {
    super('CliAuthError', message, options);
  }
}

class CliExecutionError extends BackendError {
  constructor(message: string, options?: ErrorOptions) {
    super('CliExecutionError', message, options);
  }
}

class ProviderError extends BackendError {
  constructor(message: string, options?: ErrorOptions) {
    super('ProviderError', message, options);
  }
}

class CacheError extends BackendError {
  constructor(message: string, options?: ErrorOptions) {
    super('CacheError', message, options);
  }
}

class UpdateError extends BackendError {
  constructor(message: string, options?: ErrorOptions) {
    super('UpdateError', message, options);
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function ensureError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error), { cause: error });
}

function formatLogDetails(details: unknown): string {
  return inspect(details, {
    depth: null,
    colors: false,
    compact: false,
    breakLength: 120,
    sorted: true,
  });
}

export {
  BackendError,
  CacheError,
  CliAuthError,
  CliExecutionError,
  CliMissingError,
  ensureError,
  formatLogDetails,
  ProviderError,
  UpdateError,
  ValidationError,
  getErrorMessage,
};
