var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/index.ts
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const json = /* @__PURE__ */ __name((body, status = 200) => new Response(JSON.stringify(body, null, 1) + "\n", {
      status,
      headers: { "content-type": "application/json; charset=utf-8" }
    }), "json");
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
        const run = direction.runs.find((r) => r.label === label);
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
        rows: results.token_survival.filter((row) => row.direction === direction)
      });
    }
    return env.ASSETS.fetch(request);
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
