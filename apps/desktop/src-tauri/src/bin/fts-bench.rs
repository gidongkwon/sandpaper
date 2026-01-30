use sandpaper_lib::db::Database;
use std::time::Instant;

const TOTAL_BLOCKS: usize = 100_000;

fn main() {
    let db = Database::new_in_memory().expect("db init");
    db.run_migrations().expect("migrations");

    let page_id = db.insert_page("Bench page").expect("insert page");

    let start_insert = Instant::now();
    for i in 0..TOTAL_BLOCKS {
        let uid = format!("b-{}", i);
        let content = format!("note {} alpha beta gamma", i);
        db.insert_block(page_id, &uid, &content)
            .expect("insert block");
    }
    let insert_time = start_insert.elapsed();

    let start_search = Instant::now();
    let results = db.search_blocks("alpha").expect("search");
    let search_time = start_search.elapsed();

    println!("blocks: {}", TOTAL_BLOCKS);
    println!("insert_total_ms: {}", insert_time.as_millis());
    println!("search_ms: {}", search_time.as_millis());
    println!("search_results: {}", results.len());
}
