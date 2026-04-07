use crate::rag::retrieval::search_hybrid;
use crate::rag::types::{AnswerCitation, AnswerResult, SearchHit};
use std::collections::HashSet;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
struct SentencePart {
    text: String,
    segment_index: usize,
}

#[derive(Debug, Clone)]
struct ExcerptCandidate<'a> {
    hit: &'a SearchHit,
    excerpt: String,
    score: usize,
}

fn normalize_query_terms(query: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    query
        .split(|ch: char| !ch.is_alphanumeric())
        .map(|term| term.trim().to_lowercase())
        .filter(|term| term.len() >= 2)
        .filter(|term| seen.insert(term.clone()))
        .collect::<Vec<_>>()
}

fn strip_hit_scaffold_segments(hit: &SearchHit) -> Vec<String> {
    hit.snippet
        .split("\n\n")
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .filter(|segment| *segment != hit.title)
        .filter(|segment| {
            hit.breadcrumb
                .as_deref()
                .map(|breadcrumb| *segment != breadcrumb)
                .unwrap_or(true)
        })
        .map(|segment| segment.to_string())
        .collect()
}

fn split_sentences(segments: &[String]) -> Vec<SentencePart> {
    segments
        .iter()
        .enumerate()
        .flat_map(|(segment_index, segment)| {
            segment
                .split('\n')
                .flat_map(|line| {
                    let parts = line
                        .split_terminator(['.', '!', '?'])
                        .map(str::trim)
                        .filter(|part| !part.is_empty())
                        .map(|part| SentencePart {
                            text: part.to_string(),
                            segment_index,
                        })
                        .collect::<Vec<_>>();
                    if parts.is_empty() && !line.trim().is_empty() {
                        vec![SentencePart {
                            text: line.trim().to_string(),
                            segment_index,
                        }]
                    } else {
                        parts
                    }
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

fn score_sentence(sentence: &str, query: &str, query_terms: &[String]) -> usize {
    let normalized = sentence.to_lowercase();
    let normalized_query = query.trim().to_lowercase();
    let term_hits = query_terms
        .iter()
        .filter(|term| normalized.contains(term.as_str()))
        .count();
    let phrase_bonus = if normalized_query.len() >= 2 && normalized.contains(&normalized_query) {
        4
    } else if query_terms.len() > 1 && normalized.contains(&query_terms.join(" ")) {
        2
    } else {
        0
    };
    (term_hits * 2) + phrase_bonus
}

fn extract_excerpt(hit: &SearchHit, query: &str, query_terms: &[String]) -> Option<(String, usize)> {
    let segments = strip_hit_scaffold_segments(hit);
    if segments.is_empty() {
        return None;
    }

    let sentences = split_sentences(&segments);
    if sentences.is_empty() {
        let body = segments.join("\n");
        let score = score_sentence(&body, query, query_terms);
        return (score > 0).then_some((body, score));
    }

    let (best_index, best_score) = sentences
        .iter()
        .enumerate()
        .map(|(index, sentence)| (index, score_sentence(&sentence.text, query, query_terms)))
        .max_by_key(|(_, score)| *score)?;

    if best_score == 0 {
        return None;
    }

    let mut excerpt = sentences[best_index].text.clone();
    if let Some(next) = sentences.get(best_index + 1) {
        if next.segment_index == sentences[best_index].segment_index
            && excerpt.len() + next.text.len() <= 220
        {
            excerpt.push_str(". ");
            excerpt.push_str(&next.text);
        }
    }
    if !excerpt.ends_with('.') {
        excerpt.push('.');
    }
    Some((excerpt, best_score))
}

pub fn answer_query(vault_path: &Path, query: &str, limit: usize) -> Result<AnswerResult, String> {
    let hits = search_hybrid(vault_path, query, limit)?;
    if hits.is_empty() {
        return Ok(AnswerResult {
            answer: "No relevant notes found.".to_string(),
            citations: Vec::new(),
            used_chunks: Vec::new(),
            latency_ms: 0,
            provider: "local".to_string(),
            model: "extractive-answer-v1".to_string(),
        });
    }

    let query_terms = normalize_query_terms(query);
    let mut seen_excerpt_keys = HashSet::new();
    let mut selected_hits = hits
        .iter()
        .filter_map(|hit| {
            extract_excerpt(hit, query, &query_terms).map(|(excerpt, score)| ExcerptCandidate {
                hit,
                excerpt,
                score,
            })
        })
        .filter(|candidate| {
            seen_excerpt_keys.insert(candidate.excerpt.trim().to_lowercase())
        })
        .collect::<Vec<_>>();
    selected_hits.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.hit.rank.cmp(&right.hit.rank))
    });
    selected_hits.truncate(3);

    if selected_hits.is_empty() {
        return Ok(AnswerResult {
            answer: "No confident answer found. Try a more specific query.".to_string(),
            citations: Vec::new(),
            used_chunks: Vec::new(),
            latency_ms: 0,
            provider: "local".to_string(),
            model: "extractive-answer-v2".to_string(),
        });
    }

    let answer = selected_hits
        .iter()
        .map(|candidate| format!("{}: {}", candidate.hit.title, candidate.excerpt))
        .collect::<Vec<_>>()
        .join("\n");
    let citations = selected_hits
        .iter()
        .enumerate()
        .map(|(index, candidate)| AnswerCitation {
            page_uid: candidate.hit.page_uid.clone(),
            block_uid: candidate.hit.block_uid.clone(),
            chunk_id: candidate.hit.chunk_id.clone(),
            title: candidate.hit.title.clone(),
            breadcrumb: candidate.hit.breadcrumb.clone(),
            snippet: candidate.excerpt.clone(),
            rank: index + 1,
        })
        .collect::<Vec<_>>();

    Ok(AnswerResult {
        answer,
        citations,
        used_chunks: selected_hits
            .into_iter()
            .map(|candidate| candidate.hit.chunk_id.clone())
            .collect(),
        latency_ms: 0,
        provider: "local".to_string(),
        model: "extractive-answer-v2".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::answer_query;
    use crate::rag::retrieval::rebuild_index;
    use sandpaper_core::db::Database;
    use tempfile::tempdir;

    fn setup_db() -> Database {
        let db = Database::new_in_memory().expect("db init");
        db.run_migrations().expect("migrations");
        db
    }

    #[test]
    fn answer_query_returns_empty_state_when_no_hits_exist() {
        let dir = tempdir().expect("tempdir");
        let result = answer_query(dir.path(), "semantic", 10).expect("answer");
        assert_eq!(result.answer, "No relevant notes found.");
        assert!(result.citations.is_empty());
    }

    #[test]
    fn answer_query_returns_grounded_answer_and_citations() {
        let db = setup_db();
        let page_id = db.insert_page("page-1", "Inbox").expect("insert page");
        db.insert_block(
            page_id,
            "block-1",
            None,
            "000001",
            "Overview sentence. Semantic alpha unlocks the result. Supporting detail follows.",
            "{}",
        )
            .expect("insert block");
        db.insert_block(page_id, "block-2", None, "000002", "semantic beta", "{}")
            .expect("insert block");

        let dir = tempdir().expect("tempdir");
        rebuild_index(&db, dir.path()).expect("rebuild index");

        let result = answer_query(dir.path(), "semantic", 10).expect("answer");
        assert!(result.answer.contains("Inbox"));
        assert!(result.answer.contains("Semantic alpha unlocks the result."));
        assert!(result.answer.contains("Supporting detail follows."));
        assert!(!result.answer.contains("Overview sentence."));
        assert_eq!(result.citations.len(), 2);
        assert_eq!(result.citations[0].page_uid, "page-1");
    }

    #[test]
    fn answer_query_returns_conservative_fallback_when_only_semantic_hits_exist() {
        let db = setup_db();
        let page_id = db.insert_page("page-1", "Inbox").expect("insert page");
        db.insert_block(page_id, "block-1", None, "000001", "semantic alpha concept", "{}")
            .expect("insert block");

        let dir = tempdir().expect("tempdir");
        rebuild_index(&db, dir.path()).expect("rebuild index");

        let result = answer_query(dir.path(), "semantical", 10).expect("answer");
        assert_eq!(
            result.answer,
            "No confident answer found. Try a more specific query."
        );
        assert!(result.citations.is_empty());
    }

    #[test]
    fn answer_query_does_not_pull_in_adjacent_sibling_segment() {
        let db = setup_db();
        let page_id = db.insert_page("page-1", "Inbox").expect("insert page");
        db.insert_block(
            page_id,
            "block-1",
            None,
            "000001",
            "Semantic alpha answers the question. Supporting detail stays nearby.",
            "{}",
        )
        .expect("insert block");
        db.insert_block(
            page_id,
            "block-2",
            None,
            "000002",
            "Unrelated sibling note that should not appear in the answer.",
            "{}",
        )
        .expect("insert block");

        let dir = tempdir().expect("tempdir");
        rebuild_index(&db, dir.path()).expect("rebuild index");

        let result = answer_query(dir.path(), "semantic alpha", 10).expect("answer");
        assert!(result.answer.contains("Semantic alpha answers the question."));
        assert!(result.answer.contains("Supporting detail stays nearby."));
        assert!(!result.answer.contains("Unrelated sibling note"));
    }
}
