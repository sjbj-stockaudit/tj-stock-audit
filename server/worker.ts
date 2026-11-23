import app from './app';
import type { Env } from './auth';

// Cloudflare Worker entry: /api/* is handled by the API; everything else is served
// from the built web app by the [assets] setting in wrangler.toml.
export default {
  fetch(request: Request, env: Env & { ASSETS: Fetcher }, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env & { ASSETS: Fetcher }>;
