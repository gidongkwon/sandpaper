import { serve } from "@hono/node-server";
import { createApp } from "./sync-server";
import { openSyncStore } from "./sync-store";

const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.SANDPAPER_SYNC_DB ?? "./sync-server.db";

const store = openSyncStore(dbPath);
const app = createApp(store);

serve({
  fetch: app.fetch,
  port
});

console.log(`Sandpaper sync server listening on http://localhost:${port}`);
