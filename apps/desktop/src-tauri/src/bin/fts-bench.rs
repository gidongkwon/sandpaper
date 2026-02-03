use sandpaper_core::db::Database;
use std::time::Instant;

const TOTAL_BLOCKS: usize = 100_000;
const UPDATE_BLOCKS: usize = 1_000;

fn main() {
    let db = Database::new_in_memory().expect("db init");
    db.run_migrations().expect("migrations");

    let page_id = db
        .insert_page("page-bench", "Bench page")
        .expect("insert page");

    let mut block_ids = Vec::with_capacity(TOTAL_BLOCKS);
    let start_insert = Instant::now();
    for i in 0..TOTAL_BLOCKS {
        let uid = format!("b-{}", i);
        let sort_key = format!("{:08}", i);
        let content = format!("note {} alpha beta gamma", i);
        let block_id = db
            .insert_block(page_id, &uid, None, &sort_key, &content, "{}")
            .expect("insert block");
        block_ids.push(block_id);
    }
    let insert_time = start_insert.elapsed();

    let update_count = UPDATE_BLOCKS.min(block_ids.len());
    let start_update = Instant::now();
    for i in 0..update_count {
        let block_id = block_ids[i];
        let content = format!("note {} updated alpha beta gamma", i);
        db.update_block_text(block_id, &content)
            .expect("update block");
    }
    let update_time = start_update.elapsed();
    let update_avg_ms =
        update_time.as_micros() as f64 / update_count.max(1) as f64 / 1000.0;

    let start_search = Instant::now();
    let results = db.search_blocks("alpha").expect("search");
    let search_time = start_search.elapsed();

    println!("blocks: {}", TOTAL_BLOCKS);
    println!("insert_total_ms: {}", insert_time.as_millis());
    println!("update_count: {}", update_count);
    println!("update_total_ms: {}", update_time.as_millis());
    println!("update_avg_ms: {:.3}", update_avg_ms);
    println!("search_ms: {}", search_time.as_millis());
    println!("search_results: {}", results.len());
}
