/** The results-site worker: JSON routes for agents, static assets for humans.
 *
 * Requests matching a built asset (or the SPA fallback) never invoke this
 * script — Workers assets serves them directly. Unmatched paths land here:
 *   /index.json          — the full results document (same bytes as /data/results.json)
 *   /runs/<label>.json   — one run's payload, sliced out of the results document
 *   /survival/<dir>.json — the token-survival rows for one direction
 * everything else falls back to env.ASSETS.fetch so the SPA handles it.
 */

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body, null, 1) + "\n", {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
      });

    if (url.pathname === "/index.json") {
      const data = await env.ASSETS.fetch(new URL("/data/results.json", url.origin));
      if (!data.ok) return json({ error: "results data not built; run `deno task data`" }, 503);
      return new Response(data.body, data);
    }

    const runMatch = url.pathname.match(/^\/runs\/([^/]+)\.json$/);
    if (runMatch) {
      const data = await env.ASSETS.fetch(new URL("/data/results.json", url.origin));
      if (!data.ok) return json({ error: "results data not built; run `deno task data`" }, 503);
      const results = await data.json();
      const label = decodeURIComponent(runMatch[1]);
      for (const direction of results.directions) {
        const run = direction.runs.find((r: { label: string }) => r.label === label);
        if (run) return json(run);
      }
      for (const row of results.token_survival) {
        if (row.label === label) return json(row);
      }
      return json({ error: `no run labelled ${label}` }, 404);
    }

    const survivalMatch = url.pathname.match(/^\/survival\/(en-id|id-en)\.json$/);
    if (survivalMatch) {
      const data = await env.ASSETS.fetch(new URL("/data/results.json", url.origin));
      if (!data.ok) return json({ error: "results data not built; run `deno task data`" }, 503);
      const results = await data.json();
      const direction = `${survivalMatch[1].slice(0, 2)}->${survivalMatch[1].slice(3)}`;
      return json({
        direction,
        rows: results.token_survival.filter((row: { direction: string }) => row.direction === direction),
      });
    }

    return env.ASSETS.fetch(request);
  },
};
