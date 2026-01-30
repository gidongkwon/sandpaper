import { render, screen } from "@solidjs/testing-library";
import App from "./app";

describe("App", () => {
  it("renders the outline header", () => {
    render(() => <App />);
    expect(screen.getByText("Sandpaper")).toBeInTheDocument();
  });
});
