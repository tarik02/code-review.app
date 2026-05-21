import { Cause, Predicate } from 'effect';

function getCaughtErrorMessage(cause: unknown) {
  const squashed = Cause.squash(Cause.fail(cause));
  if (
    Predicate.hasProperty(squashed, 'message') &&
    typeof squashed.message === 'string' &&
    squashed.message.length > 0
  ) {
    return squashed.message;
  }

  return new Cause.UnknownException(cause).message;
}

export { getCaughtErrorMessage };
