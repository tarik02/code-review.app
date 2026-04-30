function logInfo(message: string, details?: unknown) {
  if (details === undefined) {
    console.log(message);
    return;
  }

  console.log(message, details);
}

function logWarning(message: string, details?: unknown) {
  if (details === undefined) {
    console.warn(message);
    return;
  }

  console.warn(message, details);
}

function logError(message: string, details?: unknown) {
  if (details === undefined) {
    console.error(message);
    return;
  }

  console.error(message, details);
}

export { logError, logInfo, logWarning };
