#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct InlineFence {
    pub(crate) lang: String,
    pub(crate) content: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum MarkdownListKind {
    Ordered,
    Unordered,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MarkdownList {
    pub(crate) kind: MarkdownListKind,
    pub(crate) items: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum InlineMarkdownToken {
    Text(String),
    Wikilink { target: String, label: String },
    Link { href: String, label: String },
    Code(String),
    Bold(String),
    Italic(String),
    Strike(String),
}

pub(crate) fn parse_inline_fence(text: &str) -> Option<InlineFence> {
    let trimmed = text.trim();
    let rest = trimmed.strip_prefix("```")?.trim();
    if rest.is_empty() {
        return None;
    }
    let mut parts = rest.split_whitespace();
    let lang = parts.next()?.trim();
    if lang.is_empty() {
        return None;
    }
    let content_parts: Vec<&str> = parts.collect();
    if content_parts.is_empty() {
        return None;
    }
    Some(InlineFence {
        lang: lang.to_lowercase(),
        content: content_parts.join(" "),
    })
}

fn parse_ordered_list_item(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut chars = trimmed.chars().peekable();
    let mut saw_digit = false;
    while let Some(ch) = chars.peek().copied() {
        if ch.is_ascii_digit() {
            saw_digit = true;
            chars.next();
        } else {
            break;
        }
    }
    if !saw_digit {
        return None;
    }
    if chars.next()? != '.' {
        return None;
    }
    let mut saw_space = false;
    while let Some(ch) = chars.peek().copied() {
        if ch.is_whitespace() {
            saw_space = true;
            chars.next();
        } else {
            break;
        }
    }
    if !saw_space {
        return None;
    }
    let rest: String = chars.collect();
    let item = rest.trim();
    if item.is_empty() {
        None
    } else {
        Some(item.to_string())
    }
}

fn parse_unordered_list_item(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut chars = trimmed.chars();
    let bullet = chars.next()?;
    if !matches!(bullet, '-' | '*' | '+') {
        return None;
    }
    let mut saw_space = false;
    while let Some(ch) = chars.clone().next() {
        if ch.is_whitespace() {
            saw_space = true;
            chars.next();
        } else {
            break;
        }
    }
    if !saw_space {
        return None;
    }
    let rest: String = chars.collect();
    let item = rest.trim();
    if item.is_empty() {
        None
    } else {
        Some(item.to_string())
    }
}

pub(crate) fn parse_markdown_list(text: &str) -> Option<MarkdownList> {
    let lines: Vec<&str> = text
        .split(['\n', '\r'])
        .filter(|line| !line.trim().is_empty())
        .collect();
    if lines.len() < 2 {
        return None;
    }

    let ordered: Option<Vec<String>> = lines
        .iter()
        .map(|line| parse_ordered_list_item(line))
        .collect();
    if let Some(items) = ordered {
        return Some(MarkdownList {
            kind: MarkdownListKind::Ordered,
            items,
        });
    }

    let unordered: Option<Vec<String>> = lines
        .iter()
        .map(|line| parse_unordered_list_item(line))
        .collect();
    unordered.map(|items| MarkdownList {
        kind: MarkdownListKind::Unordered,
        items,
    })
}

pub(crate) fn parse_inline_markdown_tokens(text: &str) -> Vec<InlineMarkdownToken> {
    fn find_next(haystack: &str, needle: &str) -> Option<usize> {
        haystack.find(needle)
    }

    let mut tokens = Vec::new();
    let mut cursor = 0usize;

    while cursor < text.len() {
        let remaining = &text[cursor..];

        let candidates = [
            ("[[", 0),
            ("[", 1),
            ("`", 2),
            ("**", 3),
            ("~~", 4),
            ("*", 5),
        ];

        let mut next: Option<(usize, &str, usize)> = None;
        for (needle, priority) in candidates {
            if let Some(rel) = find_next(remaining, needle) {
                let abs = cursor + rel;
                match next {
                    None => next = Some((abs, needle, priority)),
                    Some((best_abs, _best_needle, best_priority)) => {
                        if abs < best_abs || (abs == best_abs && priority < best_priority) {
                            next = Some((abs, needle, priority));
                        }
                    }
                }
            }
        }

        let Some((start, needle, _priority)) = next else {
            tokens.push(InlineMarkdownToken::Text(text[cursor..].to_string()));
            break;
        };

        if start > cursor {
            tokens.push(InlineMarkdownToken::Text(text[cursor..start].to_string()));
            cursor = start;
        }

        let remaining = &text[cursor..];
        match needle {
            "[[" => {
                let inner_start = cursor + 2;
                let Some(rel_end) = text[inner_start..].find("]]") else {
                    tokens.push(InlineMarkdownToken::Text(text[cursor..].to_string()));
                    break;
                };
                let inner_end = inner_start + rel_end;
                let token_end = inner_end + 2;
                let inner = &text[inner_start..inner_end];
                if let Some((target, label)) = parse_wikilink_inner(inner) {
                    tokens.push(InlineMarkdownToken::Wikilink { target, label });
                } else {
                    tokens.push(InlineMarkdownToken::Text(
                        text[cursor..token_end].to_string(),
                    ));
                }
                cursor = token_end;
            }
            "[" => {
                if remaining.starts_with("[[") {
                    tokens.push(InlineMarkdownToken::Text("[".to_string()));
                    cursor += 1;
                    continue;
                }

                let inner_start = cursor + 1;
                let Some(close_bracket_rel) = text[inner_start..].find(']') else {
                    tokens.push(InlineMarkdownToken::Text(text[cursor..].to_string()));
                    break;
                };
                let close_bracket = inner_start + close_bracket_rel;
                if close_bracket + 1 >= text.len()
                    || &text[close_bracket + 1..close_bracket + 2] != "("
                {
                    tokens.push(InlineMarkdownToken::Text("[".to_string()));
                    cursor += 1;
                    continue;
                }
                let href_start = close_bracket + 2;
                let Some(close_paren_rel) = text[href_start..].find(')') else {
                    tokens.push(InlineMarkdownToken::Text(text[cursor..].to_string()));
                    break;
                };
                let close_paren = href_start + close_paren_rel;
                let label = text[inner_start..close_bracket].trim();
                let href = text[href_start..close_paren].trim();
                let token_end = close_paren + 1;
                if label.is_empty()
                    || href.is_empty()
                    || href.to_lowercase().starts_with("javascript:")
                {
                    tokens.push(InlineMarkdownToken::Text(
                        text[cursor..token_end].to_string(),
                    ));
                    cursor = token_end;
                    continue;
                }
                tokens.push(InlineMarkdownToken::Link {
                    href: href.to_string(),
                    label: label.to_string(),
                });
                cursor = token_end;
            }
            "`" => {
                let inner_start = cursor + 1;
                let Some(rel_end) = text[inner_start..].find('`') else {
                    tokens.push(InlineMarkdownToken::Text(text[cursor..].to_string()));
                    break;
                };
                let inner_end = inner_start + rel_end;
                let token_end = inner_end + 1;
                let inner = &text[inner_start..inner_end];
                if inner.is_empty() {
                    tokens.push(InlineMarkdownToken::Text(
                        text[cursor..token_end].to_string(),
                    ));
                } else {
                    tokens.push(InlineMarkdownToken::Code(inner.to_string()));
                }
                cursor = token_end;
            }
            "**" => {
                if !remaining.starts_with("**") {
                    tokens.push(InlineMarkdownToken::Text("*".to_string()));
                    cursor += 1;
                    continue;
                }
                let inner_start = cursor + 2;
                let Some(rel_end) = text[inner_start..].find("**") else {
                    tokens.push(InlineMarkdownToken::Text(text[cursor..].to_string()));
                    break;
                };
                let inner_end = inner_start + rel_end;
                let token_end = inner_end + 2;
                let inner = &text[inner_start..inner_end];
                if inner.is_empty() {
                    tokens.push(InlineMarkdownToken::Text(
                        text[cursor..token_end].to_string(),
                    ));
                } else {
                    tokens.push(InlineMarkdownToken::Bold(inner.to_string()));
                }
                cursor = token_end;
            }
            "~~" => {
                let inner_start = cursor + 2;
                let Some(rel_end) = text[inner_start..].find("~~") else {
                    tokens.push(InlineMarkdownToken::Text(text[cursor..].to_string()));
                    break;
                };
                let inner_end = inner_start + rel_end;
                let token_end = inner_end + 2;
                let inner = &text[inner_start..inner_end];
                if inner.is_empty() {
                    tokens.push(InlineMarkdownToken::Text(
                        text[cursor..token_end].to_string(),
                    ));
                } else {
                    tokens.push(InlineMarkdownToken::Strike(inner.to_string()));
                }
                cursor = token_end;
            }
            "*" => {
                if remaining.starts_with("**") {
                    tokens.push(InlineMarkdownToken::Text("*".to_string()));
                    cursor += 1;
                    continue;
                }
                let inner_start = cursor + 1;
                let Some(rel_end) = text[inner_start..].find('*') else {
                    tokens.push(InlineMarkdownToken::Text(text[cursor..].to_string()));
                    break;
                };
                let inner_end = inner_start + rel_end;
                let token_end = inner_end + 1;
                let inner = &text[inner_start..inner_end];
                if inner.is_empty() {
                    tokens.push(InlineMarkdownToken::Text(
                        text[cursor..token_end].to_string(),
                    ));
                } else {
                    tokens.push(InlineMarkdownToken::Italic(inner.to_string()));
                }
                cursor = token_end;
            }
            _ => {
                tokens.push(InlineMarkdownToken::Text(text[cursor..].to_string()));
                break;
            }
        }
    }

    let mut merged = Vec::new();
    for token in tokens.into_iter() {
        match token {
            InlineMarkdownToken::Text(value) => {
                if let Some(InlineMarkdownToken::Text(prev)) = merged.last_mut() {
                    prev.push_str(&value);
                } else {
                    merged.push(InlineMarkdownToken::Text(value));
                }
            }
            other => merged.push(other),
        }
    }

    merged
}

fn parse_wikilink_inner(inner: &str) -> Option<(String, String)> {
    let raw = inner.trim();
    if raw.is_empty() {
        return None;
    }
    let mut parts = raw.splitn(2, '|');
    let before_alias = parts.next().unwrap_or("").trim();
    let alias = parts
        .next()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    let mut target_parts = before_alias.splitn(2, '#');
    let target = target_parts.next().unwrap_or("").trim();
    if target.is_empty() {
        return None;
    }
    let label = alias.unwrap_or(target).trim();
    let label = if label.is_empty() { target } else { label };
    Some((target.to_string(), label.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_inline_fence_parses_language_and_content() {
        assert_eq!(
            parse_inline_fence("```js console.log('hi')"),
            Some(InlineFence {
                lang: "js".to_string(),
                content: "console.log('hi')".to_string()
            })
        );

        assert_eq!(
            parse_inline_fence("   ```Mermaid graph TD Start-->End;   "),
            Some(InlineFence {
                lang: "mermaid".to_string(),
                content: "graph TD Start-->End;".to_string()
            })
        );

        assert_eq!(parse_inline_fence("```js"), None);
        assert_eq!(parse_inline_fence("no fence"), None);
    }

    #[test]
    fn parse_markdown_list_parses_ordered_and_unordered() {
        assert_eq!(
            parse_markdown_list("- Alpha\n- Beta"),
            Some(MarkdownList {
                kind: MarkdownListKind::Unordered,
                items: vec!["Alpha".to_string(), "Beta".to_string()]
            })
        );

        assert_eq!(
            parse_markdown_list("1. Alpha\n2. Beta"),
            Some(MarkdownList {
                kind: MarkdownListKind::Ordered,
                items: vec!["Alpha".to_string(), "Beta".to_string()]
            })
        );

        assert_eq!(parse_markdown_list("- Only one line"), None);
        assert_eq!(parse_markdown_list("- Alpha\nBeta"), None);
    }

    #[test]
    fn parse_inline_markdown_tokens_handles_links_and_formatting() {
        assert_eq!(
            parse_inline_markdown_tokens(
                "See [Docs](https://example.com) and [[Page]] then `x` **b** *i* ~~s~~."
            ),
            vec![
                InlineMarkdownToken::Text("See ".to_string()),
                InlineMarkdownToken::Link {
                    href: "https://example.com".to_string(),
                    label: "Docs".to_string()
                },
                InlineMarkdownToken::Text(" and ".to_string()),
                InlineMarkdownToken::Wikilink {
                    target: "Page".to_string(),
                    label: "Page".to_string()
                },
                InlineMarkdownToken::Text(" then ".to_string()),
                InlineMarkdownToken::Code("x".to_string()),
                InlineMarkdownToken::Text(" ".to_string()),
                InlineMarkdownToken::Bold("b".to_string()),
                InlineMarkdownToken::Text(" ".to_string()),
                InlineMarkdownToken::Italic("i".to_string()),
                InlineMarkdownToken::Text(" ".to_string()),
                InlineMarkdownToken::Strike("s".to_string()),
                InlineMarkdownToken::Text(".".to_string()),
            ]
        );

        assert_eq!(
            parse_inline_markdown_tokens("Ignore [X](javascript:alert(1))"),
            vec![InlineMarkdownToken::Text(
                "Ignore [X](javascript:alert(1))".to_string()
            )]
        );
    }
}
