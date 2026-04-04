import type { PageSummary } from "../../../entities/page/model/page-types";
import type {
  DestinationRecommendation,
  ReviewThread
} from "../../../entities/review/model/review-types";
import { normalizePageUid } from "../../../shared/lib/page/normalize-page-uid";

type ReviewDestinationRecommendationInput = {
  thread: ReviewThread | null;
  pages: PageSummary[];
  recentDestinationPageUids: string[];
};

const WIKILINK_PATTERN = /\[\[([^[\]]+)\]\]/gu;
const TOKEN_PATTERN = /[a-z0-9][a-z0-9-]*/giu;

const toTokens = (value: string) =>
  Array.from(value.toLowerCase().matchAll(TOKEN_PATTERN), (match) => match[0]);

const getWikilinks = (thread: ReviewThread) => {
  const links = new Set<string>();
  for (const entry of thread.entries) {
    for (const match of entry.text.matchAll(WIKILINK_PATTERN)) {
      const title = match[1]?.trim();
      if (!title) continue;
      links.add(normalizePageUid(title));
    }
  }
  return links;
};

const scorePage = (
  page: PageSummary,
  threadTokens: string[],
  wikilinks: Set<string>,
  recentDestinationPageUids: string[]
) => {
  const reasons: string[] = [];
  let score = 0;
  const normalizedTitle = normalizePageUid(page.title);
  const titleTokens = new Set(toTokens(page.title));

  if (wikilinks.has(normalizedTitle) || wikilinks.has(normalizePageUid(page.uid))) {
    score += 100;
    reasons.push("Referenced by wikilink");
  }

  const overlapCount = threadTokens.filter((token) => titleTokens.has(token)).length;
  if (overlapCount > 0) {
    score += overlapCount * 10;
    reasons.push("Matches thread wording");
  }

  const recentIndex = recentDestinationPageUids.findIndex(
    (pageUid) => normalizePageUid(pageUid) === normalizePageUid(page.uid)
  );
  if (recentIndex >= 0) {
    score += Math.max(1, 5 - recentIndex);
    reasons.push("Recently used in review");
  }

  return {
    page_uid: page.uid,
    title: page.title,
    score,
    reasons,
    provider: "heuristic" as const
  };
};

export const getReviewDestinationRecommendations = ({
  thread,
  pages,
  recentDestinationPageUids
}: ReviewDestinationRecommendationInput): DestinationRecommendation[] => {
  if (!thread) return [];

  const threadTokens = thread.entries.flatMap((entry) => toTokens(entry.text));
  const wikilinks = getWikilinks(thread);

  return pages
    .map((page) => scorePage(page, threadTokens, wikilinks, recentDestinationPageUids))
    .filter((recommendation) => recommendation.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.title.localeCompare(right.title);
    })
    .slice(0, 5);
};
