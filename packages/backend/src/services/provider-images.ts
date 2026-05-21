import { createHash } from 'node:crypto';
import { HttpClient, HttpClientRequest, HttpClientResponse } from '@effect/platform';
import { Effect, Option } from 'effect';
import { ForgeProviderRegistry } from '../providers/registry.ts';

type ProviderImageInput = {
  accountId: string;
  url: string;
};

type ProviderImageResult = {
  contentType: string | null;
  data: Uint8Array | null;
};

const PROVIDER_IMAGE_PROTOCOL = 'code-review-img';
const PROVIDER_IMAGE_URL_SIGNING_SALT = 'code-review-app-provider-image-v1';
const MAX_PROVIDER_IMAGE_BYTES = 2 * 1024 * 1024;
const PROVIDER_IMAGE_TIMEOUT = '30 seconds';

function missingProviderImage(): ProviderImageResult {
  return {
    contentType: null,
    data: null,
  };
}

function createProviderImageUrl(input: ProviderImageInput) {
  const searchParams = new URLSearchParams({
    accountId: input.accountId,
    url: input.url,
  });
  searchParams.set('sig', signProviderImageUrlPayload(input));

  return `${PROVIDER_IMAGE_PROTOCOL}://provider-image?${searchParams.toString()}`;
}

function signProviderImageUrlPayload(input: ProviderImageInput) {
  return createHash('sha256')
    .update(PROVIDER_IMAGE_URL_SIGNING_SALT)
    .update('\0')
    .update(input.accountId)
    .update('\0')
    .update(input.url)
    .digest('hex');
}

function parseProviderImageUrl(input: string): ProviderImageInput | null {
  try {
    const url = new URL(input);
    if (url.protocol !== `${PROVIDER_IMAGE_PROTOCOL}:` || url.hostname !== 'provider-image') {
      return null;
    }

    const accountId = url.searchParams.get('accountId');
    const imageUrl = url.searchParams.get('url');
    const signature = url.searchParams.get('sig');
    if (!accountId || !imageUrl || !signature) {
      return null;
    }

    const parsed = {
      accountId,
      url: imageUrl,
    } satisfies ProviderImageInput;
    if (signature !== signProviderImageUrlPayload(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

const fetchProviderImage = Effect.fn('fetchProviderImage')(function* (input: ProviderImageInput) {
  const client = yield* HttpClient.HttpClient;
  const providers = yield* ForgeProviderRegistry;

  const provider = yield* providers
    .forAccount(input.accountId)
    .pipe(Effect.option, Effect.map(Option.getOrNull));
  if (!provider) {
    return missingProviderImage();
  }

  const isAllowedImageUrl = yield* provider
    .validateImageUrl(input.url)
    .pipe(Effect.option, Effect.map(Option.getOrElse(() => false)));
  if (!isAllowedImageUrl) {
    return missingProviderImage();
  }

  const authorizeRequest = yield* provider
    .authorizeRequest()
    .pipe(Effect.option, Effect.map(Option.getOrNull));
  if (!authorizeRequest) {
    return missingProviderImage();
  }

  const request = HttpClientRequest.get(input.url).pipe(
    HttpClientRequest.accept('image/*'),
    authorizeRequest,
  );

  const response = yield* client.execute(request).pipe(
    Effect.timeoutFail({
      duration: PROVIDER_IMAGE_TIMEOUT,
      onTimeout: () => new Error(`Provider image request timed out: ${input.url}`),
    }),
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.option,
    Effect.map(Option.getOrNull),
  );
  if (!response) {
    return missingProviderImage();
  }

  const data = yield* response.arrayBuffer.pipe(
    Effect.map((buffer) => new Uint8Array(buffer)),
    Effect.option,
    Effect.map(Option.getOrNull),
  );
  if (!data || data.byteLength > MAX_PROVIDER_IMAGE_BYTES) {
    return missingProviderImage();
  }

  const contentType = response.headers['content-type']?.trim() ?? null;
  if (!contentType) {
    return missingProviderImage();
  }

  return {
    contentType,
    data,
  } satisfies ProviderImageResult;
});

export {
  PROVIDER_IMAGE_PROTOCOL,
  createProviderImageUrl,
  fetchProviderImage,
  missingProviderImage,
  parseProviderImageUrl,
};
export type { ProviderImageInput, ProviderImageResult };
