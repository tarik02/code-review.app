import { ProviderError } from "../errors";
import { getValidAccessToken } from "./provider-auth";

type ApiRequestOptions = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
  accept?: string;
};

async function readResponseBody(response: Response) {
  const text = await response.text();
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
}

async function providerFetch(
  accountId: string,
  url: string,
  options: ApiRequestOptions = {},
) {
  const token = await getValidAccessToken(accountId);
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: options.accept ?? "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "rudu",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const message = await readResponseBody(response);
    throw new ProviderError(message || `Provider API returned HTTP ${response.status}`);
  }

  return response;
}

async function providerJson<T>(
  accountId: string,
  url: string,
  options: ApiRequestOptions = {},
) {
  const response = await providerFetch(accountId, url, options);
  return (await response.json()) as T;
}

async function providerText(
  accountId: string,
  url: string,
  options: ApiRequestOptions = {},
) {
  const response = await providerFetch(accountId, url, options);
  return response.text();
}

export { providerFetch, providerJson, providerText };
