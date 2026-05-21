import { protocol } from 'electron';
import {
  PROVIDER_IMAGE_PROTOCOL,
  fetchProviderImage,
  parseProviderImageUrl,
} from '@code-review-app/backend';
import { Cause, Effect } from 'effect';
import { backendRuntime } from './backend-runtime';

protocol.registerSchemesAsPrivileged([
  {
    scheme: PROVIDER_IMAGE_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

function emptyImageResponse(status: number) {
  return new Response(null, { status });
}

function registerProviderImageProtocol() {
  protocol.handle(PROVIDER_IMAGE_PROTOCOL, async (request) => {
    const input = parseProviderImageUrl(request.url);
    if (!input) {
      return emptyImageResponse(400);
    }

    try {
      const image = await backendRuntime.runPromise(fetchProviderImage(input));
      if (!image.contentType || !image.data) {
        return emptyImageResponse(404);
      }

      return new Response(image.data, {
        headers: {
          'cache-control': 'private, max-age=86400',
          'content-type': image.contentType,
        },
      });
    } catch (error) {
      void backendRuntime.runFork(
        Effect.logError('Failed to load provider image.').pipe(
          Effect.annotateLogs({
            requestUrl: request.url,
            error: new Cause.UnknownException(error).message,
          }),
        ),
      );
      return emptyImageResponse(500);
    }
  });
}

export { registerProviderImageProtocol };
