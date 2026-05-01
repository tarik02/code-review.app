import { createTRPCProxyClient, wsLink } from '@trpc/client';
import { createWorkerClient } from '@hadeeb/trpc-worker/link';
import type { AppRouter } from '@code-review-app/backend/router';

const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    wsLink({
      client: createWorkerClient({ worker: globalThis.window ?? globalThis }),
    }),
  ],
});

export { trpc };
