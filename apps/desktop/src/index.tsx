/* @refresh reload */
import { render } from "solid-js/web";
import App from "./app/app";

// Detect platform for CSS selectors ([data-platform="macos"] etc.)
const ua = navigator.platform.toUpperCase();
document.documentElement.dataset.platform = ua.includes("MAC")
  ? "macos"
  : ua.includes("WIN")
    ? "windows"
    : "linux";

render(() => <App />, document.getElementById("root") as HTMLElement);
