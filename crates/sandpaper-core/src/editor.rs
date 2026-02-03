use crate::db::BlockSnapshot;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cursor {
    pub block_ix: usize,
    pub offset: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct EditorModel {
    pub blocks: Vec<BlockSnapshot>,
    pub active_ix: usize,
}

impl EditorModel {
    pub fn new(blocks: Vec<BlockSnapshot>) -> Self {
        let mut model = Self {
            blocks,
            active_ix: 0,
        };
        model.ensure_non_empty();
        model
    }

    pub fn ensure_non_empty(&mut self) {
        if self.blocks.is_empty() {
            self.blocks.push(BlockSnapshot {
                uid: Uuid::new_v4().to_string(),
                text: String::new(),
                indent: 0,
            });
        }
        if self.active_ix >= self.blocks.len() {
            self.active_ix = self.blocks.len() - 1;
        }
    }

    pub fn active(&self) -> &BlockSnapshot {
        &self.blocks[self.active_ix]
    }

    pub fn active_mut(&mut self) -> &mut BlockSnapshot {
        &mut self.blocks[self.active_ix]
    }

    pub fn set_active_ix(&mut self, ix: usize) {
        self.active_ix = ix.min(self.blocks.len().saturating_sub(1));
    }

    pub fn insert_after_active(&mut self, text: String) -> Cursor {
        let indent = self.active().indent;
        let insert_ix = self.active_ix + 1;
        self.blocks.insert(
            insert_ix,
            BlockSnapshot {
                uid: Uuid::new_v4().to_string(),
                text,
                indent,
            },
        );
        self.active_ix = insert_ix;
        Cursor {
            block_ix: insert_ix,
            offset: 0,
        }
    }

    pub fn split_active_and_insert_after(&mut self, mut cursor: usize) -> Cursor {
        let text = self.active().text.clone();
        cursor = cursor.min(text.len());
        while cursor > 0 && !text.is_char_boundary(cursor) {
            cursor -= 1;
        }

        let before = text[..cursor].to_string();
        let after = text[cursor..].to_string();

        self.active_mut().text = before;
        self.insert_after_active(after)
    }

    pub fn delete_active_if_empty(&mut self) -> Option<Cursor> {
        if self.blocks.len() <= 1 {
            return None;
        }
        if !self.active().text.is_empty() {
            return None;
        }

        let removed_ix = self.active_ix;
        self.blocks.remove(removed_ix);

        if removed_ix < self.blocks.len() {
            self.active_ix = removed_ix;
        } else {
            self.active_ix = self.blocks.len() - 1;
        }

        Some(Cursor {
            block_ix: self.active_ix,
            offset: self.active().text.len(),
        })
    }

    pub fn merge_active_into_previous(&mut self) -> Option<Cursor> {
        if self.active_ix == 0 {
            return None;
        }

        let current_text = self.active().text.clone();
        let target_ix = self.active_ix - 1;
        let target_offset = self.blocks[target_ix].text.len();
        self.blocks[target_ix].text.push_str(&current_text);

        self.blocks.remove(self.active_ix);
        self.active_ix = target_ix;

        Some(Cursor {
            block_ix: target_ix,
            offset: target_offset,
        })
    }

    pub fn merge_next_into_active(&mut self, cursor: usize) -> Option<Cursor> {
        let next_ix = self.active_ix + 1;
        if next_ix >= self.blocks.len() {
            return None;
        }

        let next_text = self.blocks[next_ix].text.clone();
        self.active_mut().text.push_str(&next_text);
        self.blocks.remove(next_ix);

        Some(Cursor {
            block_ix: self.active_ix,
            offset: cursor.min(self.active().text.len()),
        })
    }

    pub fn indent_active(&mut self) -> bool {
        if self.active_ix == 0 {
            return false;
        }
        let current = self.active().indent;
        let prev_indent = self.blocks[self.active_ix - 1].indent;
        let next_indent = (current + 1).min(prev_indent + 1);
        if next_indent == current {
            return false;
        }
        let delta = next_indent - current;
        self.adjust_subtree_indent(delta);
        true
    }

    pub fn outdent_active(&mut self) -> bool {
        let current = self.active().indent;
        if current <= 0 {
            return false;
        }
        self.adjust_subtree_indent(-1);
        true
    }

    pub fn move_active_up(&mut self) -> bool {
        let Some(prev_start) = self.previous_sibling_start() else {
            return false;
        };
        let range = self.active_subtree_range();
        if range.start == 0 || prev_start >= range.start {
            return false;
        }
        let removed: Vec<_> = self.blocks.drain(range.clone()).collect();
        let insert_at = prev_start;
        self.blocks
            .splice(insert_at..insert_at, removed.into_iter());
        self.active_ix = insert_at;
        true
    }

    pub fn move_active_down(&mut self) -> bool {
        let range = self.active_subtree_range();
        let Some(next_start) = self.next_sibling_start(range.clone()) else {
            return false;
        };
        if next_start <= range.start {
            return false;
        }
        let removed: Vec<_> = self.blocks.drain(range.clone()).collect();
        let insert_at = self
            .subtree_range_from(next_start - removed.len())
            .end;
        self.blocks
            .splice(insert_at..insert_at, removed.into_iter());
        self.active_ix = insert_at;
        true
    }

    pub fn duplicate_active(&mut self) -> Cursor {
        let block = self.active().clone();
        let insert_ix = self.active_ix + 1;
        let clone = BlockSnapshot {
            uid: Uuid::new_v4().to_string(),
            text: block.text,
            indent: block.indent,
        };
        self.blocks.insert(insert_ix, clone);
        self.active_ix = insert_ix;
        Cursor {
            block_ix: insert_ix,
            offset: self.active().text.len(),
        }
    }

    pub fn duplicate_range(
        &mut self,
        range: std::ops::Range<usize>,
    ) -> Option<std::ops::Range<usize>> {
        if range.start >= range.end || range.start >= self.blocks.len() {
            return None;
        }
        let end = range.end.min(self.blocks.len());
        let clones: Vec<BlockSnapshot> = self.blocks[range.start..end]
            .iter()
            .map(|block| BlockSnapshot {
                uid: Uuid::new_v4().to_string(),
                text: block.text.clone(),
                indent: block.indent,
            })
            .collect();
        if clones.is_empty() {
            return None;
        }
        let insert_at = end;
        let count = clones.len();
        self.blocks
            .splice(insert_at..insert_at, clones.into_iter());
        self.active_ix = insert_at;
        Some(insert_at..insert_at + count)
    }

    pub fn delete_range(&mut self, range: std::ops::Range<usize>) -> Option<Cursor> {
        if range.start >= range.end || range.start >= self.blocks.len() {
            return None;
        }
        let end = range.end.min(self.blocks.len());
        if end - range.start >= self.blocks.len() {
            self.blocks = vec![BlockSnapshot {
                uid: Uuid::new_v4().to_string(),
                text: String::new(),
                indent: 0,
            }];
            self.active_ix = 0;
            return Some(Cursor {
                block_ix: 0,
                offset: 0,
            });
        }
        self.blocks.drain(range.start..end);
        let next_ix = if range.start < self.blocks.len() {
            range.start
        } else {
            self.blocks.len().saturating_sub(1)
        };
        self.active_ix = next_ix;
        Some(Cursor {
            block_ix: next_ix,
            offset: self.blocks[next_ix].text.len(),
        })
    }

    pub fn move_range(
        &mut self,
        range: std::ops::Range<usize>,
        direction: i32,
    ) -> Option<std::ops::Range<usize>> {
        if direction == 0 {
            return None;
        }
        if range.start >= range.end || range.start >= self.blocks.len() {
            return None;
        }
        let end = range.end.min(self.blocks.len());
        let count = end - range.start;
        if count == 0 {
            return None;
        }
        if direction < 0 {
            if range.start == 0 {
                return None;
            }
            let removed: Vec<_> = self.blocks.drain(range.start..end).collect();
            let insert_at = range.start - 1;
            self.blocks
                .splice(insert_at..insert_at, removed.into_iter());
            self.active_ix = insert_at;
            return Some(insert_at..insert_at + count);
        }
        if end >= self.blocks.len() {
            return None;
        }
        let removed: Vec<_> = self.blocks.drain(range.start..end).collect();
        let insert_at = end + 1 - count;
        self.blocks
            .splice(insert_at..insert_at, removed.into_iter());
        self.active_ix = insert_at;
        Some(insert_at..insert_at + count)
    }

    pub fn adjust_range_indent(&mut self, range: std::ops::Range<usize>, delta: i64) -> bool {
        if delta == 0 {
            return false;
        }
        if range.start >= range.end || range.start >= self.blocks.len() {
            return false;
        }
        let end = range.end.min(self.blocks.len());
        let mut changed = false;
        for block in &mut self.blocks[range.start..end] {
            let next = (block.indent + delta).max(0);
            if next != block.indent {
                block.indent = next;
                changed = true;
            }
        }
        changed
    }

    pub fn adjust_active_indent(&mut self, delta: i64) -> bool {
        if delta > 0 {
            self.indent_active()
        } else if delta < 0 {
            self.outdent_active()
        } else {
            false
        }
    }

    fn adjust_subtree_indent(&mut self, delta: i64) {
        let range = self.active_subtree_range();
        for block in &mut self.blocks[range] {
            let next = (block.indent + delta).max(0);
            block.indent = next;
        }
    }

    fn active_subtree_range(&self) -> std::ops::Range<usize> {
        self.subtree_range_from(self.active_ix)
    }

    fn subtree_range_from(&self, start: usize) -> std::ops::Range<usize> {
        if start >= self.blocks.len() {
            return start..start;
        }
        let indent = self.blocks[start].indent;
        let mut end = start + 1;
        while end < self.blocks.len() && self.blocks[end].indent > indent {
            end += 1;
        }
        start..end
    }

    fn previous_sibling_start(&self) -> Option<usize> {
        if self.active_ix == 0 {
            return None;
        }
        let indent = self.active().indent;
        let mut ix = self.active_ix - 1;
        loop {
            let block_indent = self.blocks[ix].indent;
            if block_indent == indent {
                return Some(ix);
            }
            if block_indent < indent {
                break;
            }
            if ix == 0 {
                break;
            }
            ix -= 1;
        }
        None
    }

    fn next_sibling_start(&self, range: std::ops::Range<usize>) -> Option<usize> {
        let indent = self.blocks[self.active_ix].indent;
        let mut ix = range.end;
        while ix < self.blocks.len() {
            let block_indent = self.blocks[ix].indent;
            if block_indent == indent {
                return Some(ix);
            }
            if block_indent < indent {
                return None;
            }
            ix += 1;
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::{Cursor, EditorModel};
    use crate::db::BlockSnapshot;

    fn block(uid: &str, text: &str, indent: i64) -> BlockSnapshot {
        BlockSnapshot {
            uid: uid.to_string(),
            text: text.to_string(),
            indent,
        }
    }

    #[test]
    fn split_inserts_block_after_active() {
        let mut model = EditorModel::new(vec![block("a", "hello", 0)]);
        let cursor = model.split_active_and_insert_after(2);

        assert_eq!(model.blocks.len(), 2);
        assert_eq!(model.blocks[0].text, "he");
        assert_eq!(model.blocks[1].text, "llo");
        assert_eq!(model.blocks[1].indent, 0);
        assert_eq!(model.active_ix, 1);
        assert_eq!(
            cursor,
            Cursor {
                block_ix: 1,
                offset: 0
            }
        );
    }

    #[test]
    fn split_at_end_creates_empty_block() {
        let mut model = EditorModel::new(vec![block("a", "hello", 0)]);
        model.set_active_ix(0);
        model.split_active_and_insert_after(5);
        assert_eq!(model.blocks.len(), 2);
        assert_eq!(model.blocks[0].text, "hello");
        assert_eq!(model.blocks[1].text, "");
    }

    #[test]
    fn delete_active_if_empty_keeps_single_block() {
        let mut model = EditorModel::new(vec![block("a", "", 0)]);
        assert_eq!(model.delete_active_if_empty(), None);
        assert_eq!(model.blocks.len(), 1);
    }

    #[test]
    fn delete_active_if_empty_moves_to_next_when_possible() {
        let mut model = EditorModel::new(vec![block("a", "one", 0), block("b", "", 0), block("c", "two", 0)]);
        model.set_active_ix(1);
        let cursor = model.delete_active_if_empty().expect("should delete");
        assert_eq!(model.blocks.len(), 2);
        assert_eq!(model.active_ix, 1);
        assert_eq!(model.active().uid, "c");
        assert_eq!(
            cursor,
            Cursor {
                block_ix: 1,
                offset: 3
            }
        );
    }

    #[test]
    fn merge_active_into_previous_appends_text() {
        let mut model = EditorModel::new(vec![block("a", "hello", 0), block("b", "world", 0)]);
        model.set_active_ix(1);
        let cursor = model.merge_active_into_previous().expect("merge");
        assert_eq!(model.blocks.len(), 1);
        assert_eq!(model.active_ix, 0);
        assert_eq!(model.active().text, "helloworld");
        assert_eq!(
            cursor,
            Cursor {
                block_ix: 0,
                offset: 5
            }
        );
    }

    #[test]
    fn merge_next_into_active_appends_text() {
        let mut model = EditorModel::new(vec![block("a", "hello", 0), block("b", "world", 0)]);
        model.set_active_ix(0);
        let cursor = model.merge_next_into_active(5).expect("merge");
        assert_eq!(model.blocks.len(), 1);
        assert_eq!(model.active_ix, 0);
        assert_eq!(model.active().text, "helloworld");
        assert_eq!(
            cursor,
            Cursor {
                block_ix: 0,
                offset: 5
            }
        );
    }

    #[test]
    fn indent_active_updates_subtree() {
        let mut model = EditorModel::new(vec![
            block("a", "parent", 0),
            block("b", "child", 0),
            block("c", "grand", 1),
            block("d", "next", 0),
        ]);
        model.set_active_ix(1);
        assert!(model.indent_active());
        assert_eq!(model.blocks[1].indent, 1);
        assert_eq!(model.blocks[2].indent, 2);
        assert_eq!(model.blocks[3].indent, 0);
    }

    #[test]
    fn outdent_active_updates_subtree() {
        let mut model = EditorModel::new(vec![
            block("a", "parent", 0),
            block("b", "child", 1),
            block("c", "grand", 2),
        ]);
        model.set_active_ix(1);
        assert!(model.outdent_active());
        assert_eq!(model.blocks[1].indent, 0);
        assert_eq!(model.blocks[2].indent, 1);
    }

    #[test]
    fn move_active_up_swaps_with_previous_sibling() {
        let mut model = EditorModel::new(vec![
            block("a", "one", 0),
            block("b", "two", 0),
            block("c", "three", 0),
        ]);
        model.set_active_ix(2);
        assert!(model.move_active_up());
        assert_eq!(model.blocks[0].uid, "a");
        assert_eq!(model.blocks[1].uid, "c");
        assert_eq!(model.blocks[2].uid, "b");
        assert_eq!(model.active_ix, 1);
    }

    #[test]
    fn move_active_down_swaps_with_next_sibling() {
        let mut model = EditorModel::new(vec![
            block("a", "one", 0),
            block("b", "two", 0),
            block("c", "three", 0),
        ]);
        model.set_active_ix(0);
        assert!(model.move_active_down());
        assert_eq!(model.blocks[0].uid, "b");
        assert_eq!(model.blocks[1].uid, "a");
        assert_eq!(model.blocks[2].uid, "c");
        assert_eq!(model.active_ix, 1);
    }

    #[test]
    fn move_active_up_moves_subtree() {
        let mut model = EditorModel::new(vec![
            block("a", "one", 0),
            block("b", "two", 0),
            block("b1", "two-child", 1),
            block("c", "three", 0),
        ]);
        model.set_active_ix(3);
        assert!(model.move_active_up());
        assert_eq!(model.blocks[0].uid, "a");
        assert_eq!(model.blocks[1].uid, "c");
        assert_eq!(model.blocks[2].uid, "b");
        assert_eq!(model.blocks[3].uid, "b1");
    }

    #[test]
    fn move_active_down_moves_subtree() {
        let mut model = EditorModel::new(vec![
            block("a", "one", 0),
            block("b", "two", 0),
            block("b1", "two-child", 1),
            block("c", "three", 0),
        ]);
        model.set_active_ix(1);
        assert!(model.move_active_down());
        assert_eq!(model.blocks[0].uid, "a");
        assert_eq!(model.blocks[1].uid, "c");
        assert_eq!(model.blocks[2].uid, "b");
        assert_eq!(model.blocks[3].uid, "b1");
    }

    #[test]
    fn duplicate_active_inserts_clone() {
        let mut model = EditorModel::new(vec![block("a", "hello", 0)]);
        let cursor = model.duplicate_active();
        assert_eq!(model.blocks.len(), 2);
        assert_eq!(model.blocks[0].text, "hello");
        assert_eq!(model.blocks[1].text, "hello");
        assert_ne!(model.blocks[0].uid, model.blocks[1].uid);
        assert_eq!(
            cursor,
            Cursor {
                block_ix: 1,
                offset: 5
            }
        );
    }

    #[test]
    fn duplicate_range_inserts_clones() {
        let mut model = EditorModel::new(vec![
            block("a", "one", 0),
            block("b", "two", 1),
            block("c", "three", 0),
        ]);
        let range = model.duplicate_range(1..3).expect("duplicate range");
        assert_eq!(range, 3..5);
        assert_eq!(model.blocks.len(), 5);
        assert_eq!(model.blocks[3].text, "two");
        assert_eq!(model.blocks[4].text, "three");
        assert_ne!(model.blocks[1].uid, model.blocks[3].uid);
    }

    #[test]
    fn delete_range_removes_blocks() {
        let mut model = EditorModel::new(vec![
            block("a", "one", 0),
            block("b", "two", 0),
            block("c", "three", 0),
        ]);
        let cursor = model.delete_range(1..3).expect("delete range");
        assert_eq!(model.blocks.len(), 1);
        assert_eq!(model.blocks[0].text, "one");
        assert_eq!(
            cursor,
            Cursor {
                block_ix: 0,
                offset: 3
            }
        );
    }

    #[test]
    fn delete_range_inserts_empty_when_all_removed() {
        let mut model = EditorModel::new(vec![block("a", "one", 0)]);
        let cursor = model.delete_range(0..1).expect("delete range");
        assert_eq!(model.blocks.len(), 1);
        assert_eq!(model.blocks[0].text, "");
        assert_eq!(
            cursor,
            Cursor {
                block_ix: 0,
                offset: 0
            }
        );
    }

    #[test]
    fn move_range_up_swaps_with_previous() {
        let mut model = EditorModel::new(vec![
            block("a", "one", 0),
            block("b", "two", 0),
            block("c", "three", 0),
        ]);
        let range = model.move_range(1..2, -1).expect("move up");
        assert_eq!(range, 0..1);
        assert_eq!(model.blocks[0].uid, "b");
        assert_eq!(model.blocks[1].uid, "a");
    }

    #[test]
    fn move_range_down_swaps_with_next() {
        let mut model = EditorModel::new(vec![
            block("a", "one", 0),
            block("b", "two", 0),
            block("c", "three", 0),
        ]);
        let range = model.move_range(0..1, 1).expect("move down");
        assert_eq!(range, 1..2);
        assert_eq!(model.blocks[0].uid, "b");
        assert_eq!(model.blocks[1].uid, "a");
    }

    #[test]
    fn adjust_range_indent_clamps() {
        let mut model = EditorModel::new(vec![
            block("a", "one", 0),
            block("b", "two", 1),
        ]);
        assert!(model.adjust_range_indent(0..2, -1));
        assert_eq!(model.blocks[0].indent, 0);
        assert_eq!(model.blocks[1].indent, 0);
    }
}
