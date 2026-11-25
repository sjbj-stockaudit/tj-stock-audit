import app from './app';
import type { Env } from './auth';
import { runSchedule } from './schedule';

// Cloudflare Worker entry: /api/* is handled by the API; everything else is served
// from the built web app by the [assets] setting in wrangler.toml.
// The scheduled handler runs every 15 minutes for reminders and late alerts.
export default {
  fetch(request: Request, env: Env & { ASSETS: Fetcher }, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runSchedule(env));
  },
} satisfies ExportedHandler<Env & { ASSETS: Fetcher }>;
