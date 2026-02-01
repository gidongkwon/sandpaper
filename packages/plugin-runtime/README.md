# Sandpaper Plugin Runtime

This package defines the runtime types and conventions for Sandpaper plugins.

## Entry format

Plugin entry files are executed as CommonJS-style scripts. Export a register
function with `module.exports`:

```js
module.exports = (api) => {
  api.registerRenderer(
    { id: "weather.block", title: "Weather", kind: "block", languages: ["weather"] },
    {
      render: (ctx) => ({
        summary: `Weather ${ctx.config.city ?? "Unknown"}`,
        body: { kind: "text", text: "Sunny" },
        controls: [{ id: "refresh", type: "button", label: "Refresh" }]
      })
    }
  );
};
```

## Block syntax

Block renderers are detected via inline fences:

```
```weather city="Seattle" units="c" :: 12°C Clear
```

The text after `::` is the cached summary (stored back into the block text).
