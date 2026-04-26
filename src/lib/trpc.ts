import { createTRPCProxyClient, wsLink } from "@trpc/client";
import { createWorkerClient } from "@hadeeb/trpc-worker/link";
import type { AppRouter } from "../../electron/shared/router";

const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    wsLink({
      client: createWorkerClient({ worker: window }),
    }),
  ],
});

export { trpc };
