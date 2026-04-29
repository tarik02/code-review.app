import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import { Effect } from "effect";
import { ProviderError } from "../errors.ts";
import { getValidAccessToken } from "./provider-auth.ts";
import type { AuthTokenStore } from "./token-store.ts";

type ApiRequestOptions = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
  accept?: string;
};

const API_REQUEST_TIMEOUT = "30 seconds";

function toProviderError(error: unknown) {
  return error instanceof ProviderError
    ? error
    : new ProviderError(error instanceof Error ? error.message : String(error));
}

function readResponseBody(
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<string, ProviderError> {
  return Effect.gen(function* () {
    const text = yield* response.text.pipe(Effect.mapError(toProviderError));
    if (!text) return "";
    try {
      const parsed = JSON.parse(text) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        "message" in parsed &&
        typeof parsed.message === "string"
      ) {
        return parsed.message;
      }
    } catch {
      // Keep the raw text below.
    }
    return text;
  });
}

function providerFetch(
  accountId: string,
  url: string,
  options: ApiRequestOptions = {},
): Effect.Effect<
  HttpClientResponse.HttpClientResponse,
  ProviderError,
  AuthTokenStore | HttpClient.HttpClient
> {
  return Effect.gen(function* () {
    const token = yield* getValidAccessToken(accountId).pipe(
      Effect.mapError(toProviderError),
    );
    const method = options.method?.toUpperCase() ?? "GET";
    const baseRequest =
      method === "POST"
        ? HttpClientRequest.post(url)
        : method === "PUT"
          ? HttpClientRequest.put(url)
          : method === "DELETE"
            ? HttpClientRequest.del(url)
            : HttpClientRequest.get(url);
    let request = baseRequest.pipe(
      HttpClientRequest.accept(options.accept ?? "application/json"),
      HttpClientRequest.bearerToken(token),
      HttpClientRequest.setHeader("User-Agent", "rudu"),
    );
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      request = request.pipe(HttpClientRequest.setHeader(key, value));
    }
    if (typeof options.body === "string") {
      const contentType =
        options.headers?.["Content-Type"] ??
        options.headers?.["content-type"] ??
        "text/plain";
      request = request.pipe(HttpClientRequest.bodyText(options.body, contentType));
    }

    const client = yield* HttpClient.HttpClient;
    return yield* client.execute(request).pipe(
      Effect.timeoutFail({
        duration: API_REQUEST_TIMEOUT,
        onTimeout: () =>
          new ProviderError(`Provider API request timed out after 30s: ${url}`),
      }),
      Effect.flatMap((response) =>
        HttpClientResponse.filterStatusOk(response).pipe(
          Effect.catchAll(() =>
            Effect.gen(function* () {
              const message = yield* readResponseBody(response);
              return yield* Effect.fail(
                new ProviderError(
                  message || `Provider API returned HTTP ${response.status}`,
                ),
              );
            }),
          ),
        ),
      ),
      Effect.mapError(toProviderError),
    );
  });
}

function providerJson<T>(
  accountId: string,
  url: string,
  options: ApiRequestOptions = {},
): Effect.Effect<T, ProviderError, AuthTokenStore | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const response = yield* providerFetch(accountId, url, options);
    return yield* response.json.pipe(
      Effect.map((payload) => payload as T),
      Effect.mapError(toProviderError),
    );
  });
}

function providerText(
  accountId: string,
  url: string,
  options: ApiRequestOptions = {},
): Effect.Effect<string, ProviderError, AuthTokenStore | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const response = yield* providerFetch(accountId, url, options);
    return yield* response.text.pipe(Effect.mapError(toProviderError));
  });
}

export { providerFetch, providerJson, providerText };
