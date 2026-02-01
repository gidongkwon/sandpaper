const DEFAULT_COUNT = 5;
const MAX_COUNT = 20;

const clampCount = (value) => {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_COUNT;
  return Math.min(Math.floor(value), MAX_COUNT);
};

const fetchJson = (ctx, url) => {
  const response = ctx.network.fetch(url);
  if (!response.ok) {
    const detail = response.text ? `: ${response.text}` : "";
    throw new Error(`Request failed (${response.status})${detail}`);
  }
  return JSON.parse(response.text || "null");
};

const formatSummary = (count) => {
  const timestamp = new Date().toISOString().slice(11, 16);
  return `HN top ${count} at ${timestamp}Z`;
};

const formatItem = (item, index) => {
  if (!item) return `${index + 1}. Missing story data`;
  const title = item.title || `Story ${item.id || index + 1}`;
  const url = item.url || (item.id ? `https://news.ycombinator.com/item?id=${item.id}` : "");
  return url ? `${index + 1}. ${title} (${url})` : `${index + 1}. ${title}`;
};

const buildView = (ctx) => {
  try {
    const configured = ctx.config && ctx.config.count ? Number(ctx.config.count) : DEFAULT_COUNT;
    const count = clampCount(configured);
    const ids = fetchJson(
      ctx,
      "https://hacker-news.firebaseio.com/v0/topstories.json"
    );
    const topIds = Array.isArray(ids) ? ids.slice(0, count) : [];
    const items = topIds.map((id, index) => {
      try {
        const item = fetchJson(
          ctx,
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`
        );
        return formatItem(item, index);
      } catch (error) {
        return `${index + 1}. Failed to load story ${id}`;
      }
    });

    return {
      summary: formatSummary(topIds.length),
      body: { kind: "list", items },
      controls: [{ id: "refresh", type: "button", label: "Refresh" }]
    };
  } catch (error) {
    return {
      summary: "HN fetch failed",
      status: "error",
      message: error instanceof Error ? error.message : "Failed to load stories",
      controls: [{ id: "refresh", type: "button", label: "Retry" }]
    };
  }
};

module.exports = (api) => {
  api.registerRenderer(
    {
      id: "hn-top.block",
      title: "Hacker News Top",
      kind: "block",
      languages: ["hn-top"],
      permissions: ["network"]
    },
    {
      render: buildView,
      onAction: (ctx) => {
        if (ctx.action && ctx.action.id === "refresh") {
          return buildView(ctx);
        }
        return buildView(ctx);
      }
    }
  );
};
