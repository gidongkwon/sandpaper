import type { Accessor, JSX, Setter } from "solid-js";
import type { UnlinkedReference } from "../../entities/page/model/backlink-types";
import type { PageSummary } from "../../entities/page/model/page-types";
import type { SearchResult } from "../../entities/search/model/search-types";
import { UnlinkedReferencesPane } from "../discovery/unlinked-references-pane";
import { SearchPane } from "../search/search-pane";
import { PagesPane } from "./pages-pane";

type SidebarSearchProps = {
  inputRef?: (el: HTMLInputElement) => void;
  query: Accessor<string>;
  setQuery: Setter<string>;
  filter: Accessor<"all" | "links" | "tasks" | "pinned">;
  setFilter: Setter<"all" | "links" | "tasks" | "pinned">;
  commitTerm: (value: string) => void;
  history: Accessor<string[]>;
  applyTerm: (term: string) => void;
  results: Accessor<SearchResult[]>;
  renderHighlight: (text: string) => JSX.Element;
  onResultSelect: (block: SearchResult) => void;
};

type SidebarUnlinkedProps = {
  query: Accessor<string>;
  references: Accessor<UnlinkedReference[]>;
  onLink: (ref: UnlinkedReference) => void;
};

type SidebarPagesProps = {
  pages: Accessor<PageSummary[]>;
  activePageUid: Accessor<string>;
  resolvePageUid: (value: string) => string;
  onSwitch: (uid: string) => void | Promise<void>;
  pageMessage: Accessor<string | null>;
  onCreate: () => void;
};

type SidebarContentProps = {
  search: SidebarSearchProps;
  unlinked: SidebarUnlinkedProps;
  pages: SidebarPagesProps;
};

export const SidebarContent = (props: SidebarContentProps) => {
  return (
    <SearchPane
      searchInputRef={props.search.inputRef}
      query={props.search.query}
      setQuery={props.search.setQuery}
      filter={props.search.filter}
      setFilter={props.search.setFilter}
      commitTerm={props.search.commitTerm}
      history={props.search.history}
      applyTerm={props.search.applyTerm}
      results={props.search.results}
      renderHighlight={props.search.renderHighlight}
      onResultSelect={props.search.onResultSelect}
    >
      <UnlinkedReferencesPane
        query={props.unlinked.query}
        references={props.unlinked.references}
        onLink={props.unlinked.onLink}
      />
      <PagesPane
        pages={props.pages.pages}
        activePageUid={props.pages.activePageUid}
        resolvePageUid={props.pages.resolvePageUid}
        onSwitch={props.pages.onSwitch}
        pageMessage={props.pages.pageMessage}
        onCreate={props.pages.onCreate}
      />
    </SearchPane>
  );
};
