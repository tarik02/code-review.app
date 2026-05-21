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
  readonly _tag = 'ProviderError';

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
  formatLogDetails,
  ProviderError,
  UpdateError,
  ValidationError,
};
