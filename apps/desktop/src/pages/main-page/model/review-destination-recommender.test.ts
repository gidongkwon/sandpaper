import { describe, expect, it } from "vitest";
import type { PageSummary } from "../../../entities/page/model/page-types";
import type { ReviewThread } from "../../../entities/review/model/review-types";
import { getReviewDestinationRecommendations } from "./review-destination-recommender";

const makeThread = (entries: string[]): ReviewThread => ({
  id: "thread-1",
  root_text: entries[0] ?? "",
  status: "to-review",
  entries: entries.map((text, index) => ({
    id: `entry-${index + 1}`,
    text,
    is_root: index === 0
  })),
  captured_at_start: null,
  captured_at_end: null
});

const pages: PageSummary[] = [
  { uid: "project-atlas", title: "Project Atlas" },
  { uid: "systems-design", title: "Systems Design" },
  { uid: "meeting-notes", title: "Meeting Notes" },
  { uid: "reading-list", title: "Reading List" }
];

describe("review destination recommender", () => {
  it("prioritizes pages explicitly referenced with wikilinks", () => {
    const recommendations = getReviewDestinationRecommendations({
      thread: makeThread([
        "Need to connect this to [[Systems Design]]",
        "Architecture follow-up"
      ]),
      pages,
      recentDestinationPageUids: []
    });

    expect(recommendations[0]).toMatchObject({
      page_uid: "systems-design",
      provider: "heuristic"
    });
    expect(recommendations[0]?.reasons).toContain("Referenced by wikilink");
  });

  it("ranks title overlap ahead of unrelated pages", () => {
    const recommendations = getReviewDestinationRecommendations({
      thread: makeThread([
        "Project Atlas launch checklist",
        "Atlas dependencies and blockers"
      ]),
      pages,
      recentDestinationPageUids: []
    });

    expect(recommendations[0]?.page_uid).toBe("project-atlas");
    expect(recommendations.map((item) => item.page_uid)).not.toContain("meeting-notes");
  });

  it("uses recent history as a tie-breaker", () => {
    const recommendations = getReviewDestinationRecommendations({
      thread: makeThread(["notes", "todo"]),
      pages: [
        { uid: "alpha-notes", title: "Alpha Notes" },
        { uid: "beta-notes", title: "Beta Notes" }
      ],
      recentDestinationPageUids: ["beta-notes"]
    });

    expect(recommendations[0]?.page_uid).toBe("beta-notes");
    expect(recommendations[0]?.reasons).toContain("Recently used in review");
  });

  it("returns at most five recommendations", () => {
    const recommendations = getReviewDestinationRecommendations({
      thread: makeThread(["note summary"]),
      pages: [
        { uid: "alpha-note", title: "Alpha Note" },
        { uid: "beta-note", title: "Beta Note" },
        { uid: "gamma-note", title: "Gamma Note" },
        { uid: "delta-note", title: "Delta Note" },
        { uid: "epsilon-note", title: "Epsilon Note" },
        { uid: "zeta-note", title: "Zeta Note" }
      ],
      recentDestinationPageUids: []
    });

    expect(recommendations).toHaveLength(5);
  });
});
