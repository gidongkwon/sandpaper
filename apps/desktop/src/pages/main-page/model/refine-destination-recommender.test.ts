import { describe, expect, it } from "vitest";
import type { PageSummary } from "../../../entities/page/model/page-types";
import type { RefineThread } from "../../../entities/refine/model/refine-types";
import {
  getFallbackRefineDestinationSuggestions,
  getRefineDestinationRecommendations,
  getRefineDestinationSuggestionsFromRecommendations,
  getRefineDestinationSuggestionsFromSearchHits
} from "./refine-destination-recommender";

const makeThread = (entries: string[]): RefineThread => ({
  id: "thread-1",
  root_text: entries[0] ?? "",
  status: "to-refine",
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

describe("refine destination recommender", () => {
  it("prioritizes pages explicitly referenced with wikilinks", () => {
    const recommendations = getRefineDestinationRecommendations({
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
    const recommendations = getRefineDestinationRecommendations({
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
    const recommendations = getRefineDestinationRecommendations({
      thread: makeThread(["notes", "todo"]),
      pages: [
        { uid: "alpha-notes", title: "Alpha Notes" },
        { uid: "beta-notes", title: "Beta Notes" }
      ],
      recentDestinationPageUids: ["beta-notes"]
    });

    expect(recommendations[0]?.page_uid).toBe("beta-notes");
    expect(recommendations[0]?.reasons).toContain("Recently used in refine");
  });

  it("returns at most five recommendations", () => {
    const recommendations = getRefineDestinationRecommendations({
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

  it("maps heuristic recommendations into destination suggestions", () => {
    const suggestions = getRefineDestinationSuggestionsFromRecommendations([
      {
        page_uid: "project-atlas",
        title: "Project Atlas",
        score: 42,
        reasons: ["Referenced by wikilink"],
        provider: "heuristic"
      }
    ]);

    expect(suggestions).toEqual([
      {
        page_uid: "project-atlas",
        title: "Project Atlas",
        snippet: null,
        reason: "Referenced by wikilink",
        provider: "heuristic"
      }
    ]);
  });

  it("groups rag hits by visible page and keeps the first snippet", () => {
    const suggestions = getRefineDestinationSuggestionsFromSearchHits(
      [
        {
          page_uid: "project-atlas",
          title: "Project Atlas",
          breadcrumb: "Projects",
          snippet: "Atlas launch checklist"
        },
        {
          page_uid: "project-atlas",
          title: "Project Atlas",
          breadcrumb: "Projects",
          snippet: "Later duplicate"
        },
        {
          page_uid: "systems-design",
          title: "Systems Design",
          snippet: "Cache invalidation notes"
        }
      ],
      pages
    );

    expect(suggestions).toEqual([
      {
        page_uid: "project-atlas",
        title: "Project Atlas",
        snippet: "Atlas launch checklist",
        reason: "Projects",
        provider: "rag"
      },
      {
        page_uid: "systems-design",
        title: "Systems Design",
        snippet: "Cache invalidation notes",
        reason: "RAG similarity match",
        provider: "rag"
      }
    ]);
  });

  it("provides current and recent pages as fallback suggestions", () => {
    const suggestions = getFallbackRefineDestinationSuggestions({
      pages,
      currentPageUid: "meeting-notes",
      recentDestinationPageUids: ["reading-list", "project-atlas"],
      previewsByPageUid: {
        "meeting-notes": "Notes from the latest sync meeting",
        "reading-list": "Books and papers to review next",
        "project-atlas": "Launch milestones and blockers"
      }
    });

    expect(suggestions.slice(0, 3)).toEqual([
      {
        page_uid: "meeting-notes",
        title: "Meeting Notes",
        snippet: null,
        reason: "Notes from the latest sync meeting",
        provider: "heuristic"
      },
      {
        page_uid: "reading-list",
        title: "Reading List",
        snippet: null,
        reason: "Books and papers to review next",
        provider: "heuristic"
      },
      {
        page_uid: "project-atlas",
        title: "Project Atlas",
        snippet: null,
        reason: "Launch milestones and blockers",
        provider: "heuristic"
      }
    ]);
  });
});
