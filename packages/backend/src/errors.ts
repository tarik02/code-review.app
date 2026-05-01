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

function summarizeError(error: unknown): unknown {
  if (error instanceof Error) {
    const summary: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
    for (const [key, value] of Object.entries(error)) {
      if (key === 'name' || key === 'message' || key === 'stack' || key === 'cause') {
        continue;
      }

      summary[key] = summarizeError(value);
    }
    if (error.cause !== undefined) {
      summary.cause = summarizeError(error.cause);
    }
    return summary;
  }

  if (Array.isArray(error)) {
    return error.map((value) => summarizeError(value));
  }

  if (typeof error === 'object' && error !== null) {
    return Object.fromEntries(
      Object.entries(error).map(([key, value]): [string, unknown] => [key, summarizeError(value)]),
    );
  }

  return {
    message: String(error),
  };
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
  summarizeError,
  UpdateError,
  ValidationError,
  getErrorMessage,
};
