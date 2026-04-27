import type { FileDiffMetadata } from "@pierre/diffs";
import {
  parsePatchWithContextOverrides,
  type PatchContextOverrides,
} from "./lib/patch-context";

type ParsePatchRequest = {
  type: "parse-patch";
  requestId: number;
  patch: string;
  cacheKeyPrefix: string;
  contextSize: number;
  contextOverrides?: PatchContextOverrides;
};

type ParsePatchSuccess = {
  type: "parse-patch-success";
  requestId: number;
  fileDiffs: FileDiffMetadata[];
};

type ParsePatchError = {
  type: "parse-patch-error";
  requestId: number;
  error: string;
};

type ParsePatchResponse = ParsePatchSuccess | ParsePatchError;

function postResponse(message: ParsePatchResponse) {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<ParsePatchRequest>) => {
  const message = event.data;

  if (message.type !== "parse-patch") {
    return;
  }

  try {
    const fileDiffs = parsePatchWithContextOverrides(
      message.patch,
      message.cacheKeyPrefix,
      message.contextSize,
      message.contextOverrides,
    );

    postResponse({
      type: "parse-patch-success",
      requestId: message.requestId,
      fileDiffs,
    });
  } catch (error) {
    postResponse({
      type: "parse-patch-error",
      requestId: message.requestId,
      error:
        error instanceof Error ? error.message : "Failed to parse the PR patch.",
    });
  }
};
