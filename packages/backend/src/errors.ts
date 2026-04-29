class BackendError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = code;
    this.code = code;
  }
}

class ValidationError extends BackendError {
  constructor(message: string) {
    super("ValidationError", message);
  }
}

class CliMissingError extends BackendError {
  constructor(message: string) {
    super("CliMissingError", message);
  }
}

class CliAuthError extends BackendError {
  constructor(message: string) {
    super("CliAuthError", message);
  }
}

class CliExecutionError extends BackendError {
  constructor(message: string) {
    super("CliExecutionError", message);
  }
}

class ProviderError extends BackendError {
  constructor(message: string) {
    super("ProviderError", message);
  }
}

class CacheError extends BackendError {
  constructor(message: string) {
    super("CacheError", message);
  }
}

class UpdateError extends BackendError {
  constructor(message: string) {
    super("UpdateError", message);
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export {
  BackendError,
  CacheError,
  CliAuthError,
  CliExecutionError,
  CliMissingError,
  ProviderError,
  UpdateError,
  ValidationError,
  getErrorMessage,
};
