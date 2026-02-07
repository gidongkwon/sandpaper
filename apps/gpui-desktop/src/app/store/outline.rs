use super::*;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct OutlineMaps {
    pub(crate) visible_to_actual: Vec<usize>,
    pub(crate) actual_to_visible: Vec<Option<usize>>,
    pub(crate) has_children_by_actual: Vec<bool>,
    pub(crate) parent_by_actual: Vec<Option<usize>>,
}

pub(crate) fn collapsed_storage_key(page_uid: &str) -> String {
    format!("outline.collapsed:{page_uid}")
}

pub(crate) fn serialize_collapsed(collapsed: &HashSet<String>) -> String {
    let mut ids: Vec<_> = collapsed.iter().cloned().collect();
    ids.sort();
    serde_json::to_string(&ids).unwrap_or_else(|_| "[]".to_string())
}

pub(crate) fn deserialize_collapsed(raw: &str) -> HashSet<String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return HashSet::new();
    };
    let Some(array) = value.as_array() else {
        return HashSet::new();
    };
    array
        .iter()
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect()
}

pub(crate) fn build_outline(blocks: &[BlockSnapshot], collapsed: &HashSet<String>) -> OutlineMaps {
    let len = blocks.len();
    if len == 0 {
        return OutlineMaps::default();
    }

    let mut visible_to_actual = Vec::with_capacity(len);
    let mut actual_to_visible = vec![None; len];
    let mut has_children_by_actual = vec![false; len];
    let mut parent_by_actual = vec![None; len];

    let mut stack: Vec<usize> = Vec::new();
    let mut collapsed_flags: Vec<bool> = Vec::new();
    let mut embedded_flags: Vec<bool> = Vec::new();

    for index in 0..len {
        let indent = blocks[index].indent;

        while let Some(&top) = stack.last() {
            if blocks[top].indent >= indent {
                stack.pop();
                collapsed_flags.pop();
                embedded_flags.pop();
            } else {
                break;
            }
        }

        let parent_index = stack.last().copied();
        parent_by_actual[index] = parent_index;

        let has_children = blocks
            .get(index + 1)
            .is_some_and(|next| next.indent > indent);
        has_children_by_actual[index] = has_children;

        let ancestor_collapsed = collapsed_flags.last().copied().unwrap_or(false);
        let ancestor_embedded = embedded_flags.last().copied().unwrap_or(false);
        let is_collapsed = has_children && collapsed.contains(&blocks[index].uid);
        let is_embedded_parent =
            has_children && matches!(blocks[index].block_type, BlockType::ColumnLayout);

        if !ancestor_collapsed && !ancestor_embedded {
            let visible_ix = visible_to_actual.len();
            visible_to_actual.push(index);
            actual_to_visible[index] = Some(visible_ix);
        }

        if has_children {
            stack.push(index);
            collapsed_flags.push(ancestor_collapsed || is_collapsed);
            embedded_flags.push(ancestor_embedded || is_embedded_parent);
        }
    }

    OutlineMaps {
        visible_to_actual,
        actual_to_visible,
        has_children_by_actual,
        parent_by_actual,
    }
}

pub(crate) fn selected_actual_indexes_for_visible_range(
    visible_to_actual: &[usize],
    start_visible: usize,
    end_visible: usize,
) -> Vec<usize> {
    if visible_to_actual.is_empty() {
        return Vec::new();
    }
    let start = start_visible.min(visible_to_actual.len().saturating_sub(1));
    let end = end_visible.min(visible_to_actual.len().saturating_sub(1));
    let (lo, hi) = if start <= end {
        (start, end)
    } else {
        (end, start)
    };
    (lo..=hi)
        .filter_map(|ix| visible_to_actual.get(ix).copied())
        .collect()
}

pub(crate) fn restore_visible_range_by_uids(
    blocks: &[BlockSnapshot],
    actual_to_visible: &[Option<usize>],
    uids: &[String],
) -> Option<(usize, usize)> {
    let mut visible: Vec<usize> = uids
        .iter()
        .filter_map(|uid| {
            let actual_ix = blocks.iter().position(|block| &block.uid == uid)?;
            actual_to_visible.get(actual_ix).copied().flatten()
        })
        .collect();
    if visible.is_empty() {
        return None;
    }
    visible.sort_unstable();
    Some((visible[0], *visible.last().unwrap_or(&visible[0])))
}

pub(crate) fn subtree_end(blocks: &[BlockSnapshot], start: usize) -> usize {
    let Some(block) = blocks.get(start) else {
        return start;
    };
    let base_indent = block.indent;
    let mut end = start;
    for (ix, block) in blocks.iter().enumerate().skip(start + 1) {
        if block.indent <= base_indent {
            break;
        }
        end = ix;
    }
    end
}

pub(crate) fn fold_to_level(blocks: &[BlockSnapshot], level: i64) -> HashSet<String> {
    let mut collapsed = HashSet::new();
    if level < 0 {
        return collapsed;
    }

    for (ix, block) in blocks.iter().enumerate() {
        let has_children = blocks
            .get(ix + 1)
            .is_some_and(|next| next.indent > block.indent);
        if has_children && block.indent >= level {
            collapsed.insert(block.uid.clone());
        }
    }

    collapsed
}

#[allow(dead_code)] // Used in tests
pub(crate) fn expand_ancestors(
    blocks: &[BlockSnapshot],
    parent_by_actual: &[Option<usize>],
    target_ix: usize,
    collapsed: &mut HashSet<String>,
) -> bool {
    let mut changed = false;
    let mut current = parent_by_actual.get(target_ix).copied().flatten();
    while let Some(ix) = current {
        if let Some(block) = blocks.get(ix) {
            if collapsed.remove(&block.uid) {
                changed = true;
            }
        }
        current = parent_by_actual.get(ix).copied().flatten();
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(uid: &str, indent: i64) -> BlockSnapshot {
        block_with_type(uid, indent, BlockType::Text)
    }

    fn block_with_type(uid: &str, indent: i64, block_type: BlockType) -> BlockSnapshot {
        BlockSnapshot {
            uid: uid.to_string(),
            text: uid.to_string(),
            indent,
            block_type,
        }
    }

    #[test]
    fn build_outline_hides_descendants_when_collapsed() {
        let blocks = vec![block("a", 0), block("b", 1), block("c", 1), block("d", 0)];
        let mut collapsed = HashSet::new();
        collapsed.insert("a".to_string());
        let outline = build_outline(&blocks, &collapsed);
        assert_eq!(outline.visible_to_actual, vec![0, 3]);
        assert_eq!(
            outline.actual_to_visible,
            vec![Some(0), None, None, Some(1)]
        );
        assert_eq!(
            outline.has_children_by_actual,
            vec![true, false, false, false]
        );
        assert_eq!(outline.parent_by_actual, vec![None, Some(0), Some(0), None]);
    }

    #[test]
    fn fold_to_level_collapses_expected_nodes() {
        let blocks = vec![
            block("a", 0),
            block("b", 1),
            block("c", 2),
            block("d", 1),
            block("e", 0),
        ];
        let collapsed = fold_to_level(&blocks, 1);
        assert!(collapsed.contains("b"));
        assert!(!collapsed.contains("a"));
        assert!(!collapsed.contains("e"));
    }

    #[test]
    fn fold_to_level_level_zero_collapses_all_parents() {
        let blocks = vec![block("a", 0), block("b", 1), block("c", 0)];
        let collapsed = fold_to_level(&blocks, 0);
        assert!(collapsed.contains("a"));
        assert!(!collapsed.contains("b"));
        assert!(!collapsed.contains("c"));
    }

    #[test]
    fn deserialize_collapsed_returns_empty_on_invalid_json() {
        let collapsed = deserialize_collapsed("not json");
        assert!(collapsed.is_empty());
    }

    #[test]
    fn serialize_and_deserialize_collapsed_roundtrip() {
        let collapsed = HashSet::from(["b".to_string(), "a".to_string()]);
        let raw = serialize_collapsed(&collapsed);
        assert_eq!(raw, "[\"a\",\"b\"]");
        let decoded = deserialize_collapsed(&raw);
        assert_eq!(decoded, collapsed);
    }

    #[test]
    fn selected_actual_indexes_maps_visible_range() {
        let visible_to_actual = vec![0, 2, 5];
        assert_eq!(
            selected_actual_indexes_for_visible_range(&visible_to_actual, 0, 1),
            vec![0, 2]
        );
    }

    #[test]
    fn restore_visible_range_by_uids_ignores_missing_and_hidden() {
        let blocks = vec![block("a", 0), block("b", 0), block("c", 0)];
        let actual_to_visible = vec![Some(0), None, Some(1)];
        let range = restore_visible_range_by_uids(
            &blocks,
            &actual_to_visible,
            &["c".to_string(), "missing".to_string(), "b".to_string()],
        );
        assert_eq!(range, Some((1, 1)));
    }

    #[test]
    fn expand_ancestors_uncollapses_parent_chain() {
        let blocks = vec![block("a", 0), block("b", 1), block("c", 2)];
        let collapsed = HashSet::from(["a".to_string(), "b".to_string()]);
        let outline = build_outline(&blocks, &collapsed);
        let mut collapsed = collapsed;
        let changed = expand_ancestors(&blocks, &outline.parent_by_actual, 2, &mut collapsed);
        assert!(changed);
        assert!(collapsed.is_empty());
    }

    #[test]
    fn outline_maps_are_consistent() {
        let blocks = vec![block("a", 0), block("b", 0), block("c", 0)];
        let outline = build_outline(&blocks, &HashSet::new());
        for (visible_ix, actual_ix) in outline.visible_to_actual.iter().copied().enumerate() {
            assert_eq!(outline.actual_to_visible[actual_ix], Some(visible_ix));
        }
    }

    #[test]
    fn build_outline_hides_column_layout_descendants() {
        let blocks = vec![
            block_with_type("layout", 0, BlockType::ColumnLayout),
            block_with_type("col-a", 1, BlockType::Column),
            block("a-child", 2),
            block_with_type("col-b", 1, BlockType::Column),
            block("b-child", 2),
            block("after", 0),
        ];

        let outline = build_outline(&blocks, &HashSet::new());
        assert_eq!(outline.visible_to_actual, vec![0, 5]);
        assert_eq!(
            outline.actual_to_visible,
            vec![Some(0), None, None, None, None, Some(1)]
        );
    }
}
