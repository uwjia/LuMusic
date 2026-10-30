//! LRC lyrics parsing (pure logic, zero IO).
//!
//! Grammar handled (see https://en.wikipedia.org/wiki/LRC_(file_format)):
//! - `[mm:ss]`, `[mm:ss.xx]`, `[mm:ss.xxx]` time tags; a `,` may also
//!   separate the fraction (`[00:01,50]`). Every further `:`-separated
//!   group keeps scaling ×60, so `[hh:mm:ss.xx]` works for long files.
//! - Several time tags on one line expand to one entry each (chorus repeats).
//! - ID tags (`[ti:…]`, `[ar:…]`, `[by:…]`, …) carry no timestamp and are
//!   skipped; `[offset:±ms]` shifts every line globally. A positive offset
//!   makes lyrics appear *sooner*, i.e. it is subtracted from each time.
//! - Lines with a time tag but empty text are kept as interlude markers —
//!   the renderer draws them as spacers.
//! - Enhanced-LRC word tags (`<mm:ss.xx>`) are stripped from the text so
//!   only the words remain.
//!
//! Output lines are sorted by timestamp (stable, so file order wins on ties).

/// One line of lyrics with its start time in milliseconds.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct LyricLine {
    pub time_ms: u64,
    pub text: String,
}

/// Parsed lyrics for one track.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Lyrics {
    /// Lines sorted by `time_ms`; empty `text` marks an interlude.
    pub lines: Vec<LyricLine>,
    /// Raw `[offset:…]` value from the file (already applied to `lines`).
    pub offset_ms: i64,
}

/// Parses the textual content of an LRC file.
pub fn parse_lrc(input: &str) -> Lyrics {
    // A UTF-8 BOM would glue itself to the first tag; drop it if present
    // (decoders usually strip it, but stray BOMs occur mid-pipeline).
    let input = input.strip_prefix('\u{FEFF}').unwrap_or(input);

    let mut offset_ms: i64 = 0;
    let mut lines: Vec<LyricLine> = Vec::new();

    for raw in input.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }

        // Consume leading `[…]` groups: time tags accumulate, any other
        // bracket (metadata like `ti:`/`offset:`) ends tag scanning.
        let mut rest = line;
        let mut times: Vec<u64> = Vec::new();
        while let Some(content) = bracket_content(rest) {
            match parse_time_ms(content) {
                Some(time) => {
                    times.push(time);
                    rest = &rest[content.len() + 2..];
                }
                None => {
                    if let Some(value) = parse_offset_ms(content) {
                        offset_ms = value;
                    }
                    // Unknown/metadata bracket: not a time tag, stop here.
                    break;
                }
            }
        }
        if times.is_empty() {
            // Metadata-only line or a stray plain-text line: no lyrics time.
            continue;
        }

        let text = strip_word_tags(rest).trim().to_string();
        for time in times {
            lines.push(LyricLine {
                time_ms: apply_offset(time, offset_ms),
                text: text.clone(),
            });
        }
    }

    lines.sort_by_key(|line| line.time_ms);
    Lyrics { lines, offset_ms }
}

/// `rest` starts with `'['`: returns the text inside the leading bracket.
fn bracket_content(rest: &str) -> Option<&str> {
    if !rest.starts_with('[') {
        return None;
    }
    let end = rest.find(']')?;
    // Reject `]` inside the tag itself (keep the scan simple and total).
    if rest[1..end].contains('[') {
        return None;
    }
    Some(&rest[1..end])
}

/// `[offset:±500]` → `500` / `-500` (sign optional, bare numbers allowed).
fn parse_offset_ms(content: &str) -> Option<i64> {
    // Tag names arrive in mixed case in the wild; values are digits/signs,
    // so matching against the lowercased copy is safe.
    let lower = content.to_ascii_lowercase();
    let value = lower.strip_prefix("offset:")?;
    value.trim().parse::<i64>().ok()
}

/// Parses `mm:ss(.xx…)` / `mm:ss(,xx…)` / `hh:mm:ss(.xx…)` into milliseconds.
fn parse_time_ms(content: &str) -> Option<u64> {
    // Split into leading numeric groups and an optional fraction.
    let (groups, fraction) = match content.split_once(|c| c == '.' || c == ',') {
        Some((head, frac)) => (head, Some(frac)),
        None => (content, None),
    };

    let mut parts = groups.split(':');
    let mut value_secs: u64 = 0;
    let mut count = 0;
    for part in parts.by_ref() {
        if part.is_empty() {
            return None;
        }
        let n: u64 = part.parse().ok()?;
        value_secs = value_secs * 60 + n;
        count += 1;
    }
    // A time tag needs at least `mm:ss`; bare numbers are not timestamps.
    if count < 2 {
        return None;
    }

    // Fraction: `.5` = 500ms, `.56` = 560ms, `.5625` truncated to 562ms.
    // A dot/comma without trailing digits invalidates the whole tag.
    let millis = match fraction {
        Some(frac) => {
            let digits: String = frac.chars().take_while(char::is_ascii_digit).collect();
            if digits.is_empty() {
                return None;
            }
            let padded = format!("{digits:0<3}");
            padded[..3].parse::<u64>().ok()?
        }
        None => 0,
    };

    Some(value_secs * 1000 + millis)
}

/// Positive offset displays lyrics sooner → subtract; clamp at zero.
fn apply_offset(time_ms: u64, offset_ms: i64) -> u64 {
    // `.max(0)` instead of `clamp(0, u64::MAX as i64)`: casting u64::MAX to
    // i64 wraps to -1, which panics in clamp.
    (time_ms as i64 - offset_ms).max(0) as u64
}

/// Removes enhanced-LRC word tags (`<mm:ss.xx>word` → `word`).
fn strip_word_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('<') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('>') {
            // Only strip when the bracket really is a time tag; anything
            // else (math like "a<b>") is kept verbatim.
            Some(end) if parse_time_ms(&after[..end]).is_some() => {
                rest = &after[end + 1..];
            }
            _ => {
                out.push('<');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn times(lyrics: &Lyrics) -> Vec<u64> {
        lyrics.lines.iter().map(|l| l.time_ms).collect()
    }

    fn texts(lyrics: &Lyrics) -> Vec<&str> {
        lyrics.lines.iter().map(|l| l.text.as_str()).collect()
    }

    #[test]
    fn parses_basic_lines_and_ignores_metadata() {
        let lyrics = parse_lrc(
            "[ti:I Will Do]\n[ar:Pierre]\n[al:Booom]\n[by:someone]\n[00:00.76]I will do do do\n[00:03.10]I'll do anything for you\n",
        );
        assert_eq!(texts(&lyrics), ["I will do do do", "I'll do anything for you"]);
        assert_eq!(times(&lyrics), [760, 3100]);
        assert_eq!(lyrics.offset_ms, 0);
    }

    #[test]
    fn multiple_time_tags_expand_and_sort_by_time() {
        // The later verse carries an earlier repeat: output must be sorted.
        let lyrics =
            parse_lrc("[01:23.09][00:32.40]Late at night when we are all by ourselves\n");
        assert_eq!(times(&lyrics), [32_400, 83_090]);
        assert_eq!(texts(&lyrics), ["Late at night when we are all by ourselves"; 2]);
    }

    #[test]
    fn positive_offset_shifts_lines_earlier_and_clamps_at_zero() {
        let lyrics = parse_lrc("[offset:500]\n[00:00.20]First\n[00:01.00]Second\n");
        assert_eq!(lyrics.offset_ms, 500);
        // 200ms - 500ms clamps to 0; 1000ms - 500ms shifts to 500ms.
        assert_eq!(times(&lyrics), [0, 500]);
    }

    #[test]
    fn negative_offset_shifts_lines_later() {
        let lyrics = parse_lrc("[offset:-500]\n[00:01.00]Late\n");
        assert_eq!(times(&lyrics), [1500]);
    }

    #[test]
    fn timestamp_variants_are_supported() {
        let lyrics = parse_lrc(
            "[00:12]A\n[00:12,5]B\n[00:12.562]C\n[01:02:03.5]D\n",
        );
        assert_eq!(
            times(&lyrics),
            [12_000, 12_500, 12_562, (1 * 3600 + 2 * 60 + 3) * 1000 + 500]
        );
    }

    #[test]
    fn empty_text_lines_become_interlude_markers() {
        let lyrics = parse_lrc("[00:00.76]Verse\n[00:11.16]\n[00:11.98]Chorus\n");
        assert_eq!(texts(&lyrics), ["Verse", "", "Chorus"]);
    }

    #[test]
    fn word_tags_are_stripped_but_plain_brackets_survive() {
        let lyrics = parse_lrc("[00:01.00]<00:01.00>Nev<00:01.40>er\n[00:05.00]a < b > c\n");
        assert_eq!(texts(&lyrics), ["Never", "a < b > c"]);
    }

    #[test]
    fn lines_without_time_tags_are_dropped() {
        let lyrics = parse_lrc("plain text\n[]\n[not a tag]\n[00:01.00]kept\n");
        assert_eq!(texts(&lyrics), ["kept"]);
    }

    #[test]
    fn crlf_and_bom_are_tolerated() {
        let lyrics = parse_lrc("\u{FEFF}[00:01.50]line one\r\n[00:02.50]line two\r\n");
        assert_eq!(texts(&lyrics), ["line one", "line two"]);
        assert_eq!(times(&lyrics), [1500, 2500]);
    }

    #[test]
    fn same_timestamps_keep_file_order() {
        let lyrics = parse_lrc("[00:10.00]second-in-file\n[00:10.00]first-in-file\n");
        assert_eq!(texts(&lyrics), ["second-in-file", "first-in-file"]);
        assert_eq!(times(&lyrics), [10_000, 10_000]);
    }

    #[test]
    fn fraction_pads_and_truncates_to_milliseconds() {
        // .5 → 500ms, .5625 truncated to 562ms; a trailing dot with no digits
        // (or any non-numeric group) invalidates the whole tag.
        let lyrics = parse_lrc("[00:01.5]A\n[00:02.5625]B\n[00:03.]C\n");
        assert_eq!(times(&lyrics), [1500, 2562]);
    }

    #[test]
    fn invalid_tags_do_not_panic() {
        let lyrics = parse_lrc("[aa:bb.xx]x\n[:]\n[::]\n[00:xx]y\n[999999:99.99]z\n");
        assert_eq!(texts(&lyrics), ["z"]);
    }

    #[test]
    fn empty_input_yields_empty_lyrics() {
        assert_eq!(parse_lrc(""), Lyrics::default());
        assert_eq!(parse_lrc("\n\n \n\t\n").lines, Vec::<LyricLine>::new());
    }
}
