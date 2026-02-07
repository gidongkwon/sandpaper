use sandpaper_core::app;
use sandpaper_core::db::Database;
use sandpaper_core::editor::EditorModel;
use sandpaper_core::links::extract_wikilinks;

fn setup_db() -> Database {
    let db = Database::new_in_memory().expect("db init");
    db.run_migrations().expect("migrations");
    db
}

#[test]
fn create_page_and_add_blocks_roundtrip() {
    let db = setup_db();

    // Create a page
    let page_id = app::ensure_page(&db, "my-notes", "My Notes").expect("ensure page");
    assert!(page_id > 0);

    // Add blocks to the page
    db.insert_block(page_id, "b1", None, "a", "First paragraph", "{}")
        .expect("insert block 1");
    db.insert_block(page_id, "b2", None, "b", "Second paragraph", "{}")
        .expect("insert block 2");
    db.insert_block(page_id, "b3", None, "c", "- [ ] A todo item", "{}")
        .expect("insert block 3");

    // Verify blocks are stored and retrievable
    let blocks = db.load_blocks_for_page(page_id).expect("load blocks");
    assert_eq!(blocks.len(), 3);
    assert_eq!(blocks[0].uid, "b1");
    assert_eq!(blocks[0].text, "First paragraph");
    assert_eq!(blocks[1].uid, "b2");
    assert_eq!(blocks[2].uid, "b3");

    // Verify page is retrievable
    let page = db
        .get_page_by_uid("my-notes")
        .expect("get page")
        .expect("page exists");
    assert_eq!(page.title, "My Notes");
    assert_eq!(page.id, page_id);
}

#[test]
fn wikilink_creates_backlink_record() {
    let db = setup_db();

    // Create two pages
    let page_a_id = app::ensure_page(&db, "page-a", "Page A").expect("page a");
    let page_b_id = app::ensure_page(&db, "page-b", "Page B").expect("page b");

    // Add a block in page B that links to page A via wikilink
    db.insert_block(
        page_b_id,
        "link-block",
        None,
        "a",
        "See [[page-a]] for details",
        "{}",
    )
    .expect("insert link block");

    // Verify the wikilink is detectable via database query
    let blocks_with_links = db.list_blocks_with_wikilinks().expect("list wikilinks");
    assert!(
        !blocks_with_links.is_empty(),
        "should find blocks with wikilinks"
    );

    // Find the linking block
    let linking = blocks_with_links
        .iter()
        .find(|b| b.block_uid == "link-block");
    assert!(linking.is_some(), "should find our link block");
    let linking = linking.unwrap();
    assert_eq!(linking.page_uid, "page-b");

    // Verify the wikilink target is extractable
    let links = extract_wikilinks(&linking.text);
    assert_eq!(links.len(), 1);
    assert_eq!(links[0], "page-a");

    // Also verify page A has no blocks with links (it's the target, not the source)
    let page_a_blocks = db.load_blocks_for_page(page_a_id).expect("load page a");
    assert!(page_a_blocks.is_empty());
}

#[test]
fn editor_model_roundtrip_with_blocks() {
    let db = setup_db();

    let page_id = app::ensure_page(&db, "editor-test", "Editor Test").expect("page");
    db.insert_block(page_id, "e1", None, "a", "Line one", "{}")
        .expect("b1");
    db.insert_block(page_id, "e2", None, "b", "Line two", "{}")
        .expect("b2");

    let blocks = db.load_blocks_for_page(page_id).expect("load");
    let mut editor = EditorModel::new(blocks);

    assert_eq!(editor.blocks.len(), 2);
    assert_eq!(editor.active().uid, "e1");

    // Navigate to next block by setting active index
    editor.active_ix = 1;
    assert_eq!(editor.active().uid, "e2");

    // Insert a new block after the active one
    let cursor = editor.insert_after_active("New block".to_string());
    assert_eq!(editor.blocks.len(), 3);
    assert_eq!(cursor.block_ix, 2);
    assert_eq!(editor.blocks[2].text, "New block");
}

#[test]
fn search_pages_returns_matching_results() {
    let db = setup_db();

    app::ensure_page(&db, "rust-notes", "Rust Programming Notes").expect("page 1");
    app::ensure_page(&db, "python-notes", "Python Scripts").expect("page 2");
    app::ensure_page(&db, "daily-log", "Daily Log").expect("page 3");

    let results = db.search_pages("rust").expect("search");
    assert_eq!(results.len(), 1);

    let page = db
        .get_page_by_uid("rust-notes")
        .expect("lookup")
        .expect("exists");
    assert!(results.contains(&page.id));

    // No results for non-matching query
    let empty = db.search_pages("javascript").expect("search empty");
    assert!(empty.is_empty());
}

#[test]
fn block_search_returns_page_context() {
    let db = setup_db();

    let page_id = app::ensure_page(&db, "search-test", "Search Test Page").expect("page");
    db.insert_block(
        page_id,
        "sb1",
        None,
        "a",
        "The quick brown fox jumps over the lazy dog",
        "{}",
    )
    .expect("insert block");

    let summaries = db
        .search_block_page_summaries("quick brown", 10)
        .expect("search blocks");
    assert!(!summaries.is_empty());
    assert_eq!(summaries[0].page_title, "Search Test Page");
}
