# Hacker News Top Plugin (Sample)

This sample plugin registers a block renderer that fetches the top Hacker News stories.

## Install into a vault

1. Copy this folder into your vault under `plugins/hn-top/`.
2. Ensure the folder contains `plugin.json` and `hn-top.js`.
3. Open the app and go to Settings -> Plugins.
4. Enable the "Hacker News Top" plugin when it appears.

## Add a block

Create a new block with the inline fence syntax:

````text
```hn-top count=5 :: Loading HN top
```
````

- `hn-top` is the renderer language.
- `count=5` is optional and defaults to 5 (max 20).
- The text after `::` is the cached summary stored in the block.

After the plugin renders, the block summary will be updated and the list will show the top stories. Use the Refresh button to fetch again.
