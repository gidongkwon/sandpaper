import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import {
  MainPageProvider,
  useMainPageContext,
  type MainPageContextValue
} from "./main-page-context";

describe("MainPageContext", () => {
  it("throws when used outside the provider", () => {
    const Reader = () => {
      useMainPageContext();
      return null;
    };

    expect(() => render(() => <Reader />)).toThrow(/MainPageContext/);
  });

  it("exposes the provided value", () => {
    let captured: MainPageContextValue | null = null;
    const Reader = () => {
      captured = useMainPageContext();
      return <div data-testid="context" />;
    };
    const value = {
      workspace: {} as MainPageContextValue["workspace"],
      overlays: {} as MainPageContextValue["overlays"]
    } as MainPageContextValue;

    render(() => (
      <MainPageProvider value={value}>
        <Reader />
      </MainPageProvider>
    ));

    expect(captured).toBe(value);
  });
});
