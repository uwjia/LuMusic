//! Encoding repair for legacy tag text.
//!
//! Older taggers (popular in the CJK markets) wrote ID3v2.3 frames encoded in
//! GBK/Big5/Shift-JIS but declared them as ISO-8859-1. Tag readers therefore
//! decode the bytes as Latin-1, producing mojibake such as `Ä£ÃÖ` instead of
//! `ÄãºÃ`-style garbage that should have been `ÒôÀÖ` ("音乐").
//!
//! Strategy (`fix_mojibake`): a Latin-1 misread is *reversible* because
//! ISO-8859-1 maps bytes 0x00-0xFF to code points U+0000-U+00FF. So:
//! 1. only consider strings whose chars all fit in U+0000..=U+00FF and show
//!    at least two Latin-1 supplement characters (mojibake evidence);
//! 2. map the string back to raw bytes;
//! 3. decode those bytes with each candidate encoding (UTF-8, GB18030, Big5,
//!    Shift-JIS, EUC-KR), skipping decodings with errors/replacements;
//! 4. score every candidate (CJK scripts are rewarded, leftover Latin-1
//!    supplement characters and control/replacement characters are punished);
//! 5. accept the winner only when it strictly beats the original score.
//!
//! GB18030 is checked before the other CJK encodings because it is the
//! superset most commonly seen in the wild; ties therefore resolve in its
//! favor. This is a heuristic: exotic pure-Big5/Shift-JIS libraries may still
//! be mis-guessed, but Western text (French/German/Swedish, ...) is never
//! touched because it does not improve under any candidate.

use encoding_rs::{BIG5, EUC_KR, GB18030, SHIFT_JIS, UTF_8};

/// Candidate encodings, most-likely-first (ties keep the earlier candidate).
const CANDIDATES: [&'static encoding_rs::Encoding; 5] =
    [&UTF_8, &GB18030, &BIG5, &SHIFT_JIS, &EUC_KR];

/// Minimum number of Latin-1 supplement chars before a repair is attempted;
/// protects real Western titles such as `Björk` or `Café`.
const MIN_LATIN1_EVIDENCE: usize = 2;

/// Confidence bonus for a *valid* UTF-8 decoding. Without it a 3-byte-per-CJK
/// char UTF-8 string loses to a 2-byte encoding that squeezes more hanzi out
/// of the same bytes.
const UTF8_BONUS: i64 = 4;

/// Repairs Latin-1 mojibake when a CJK decoding is clearly better.
pub fn fix_mojibake(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return text.to_string();
    }
    if !is_latin1_reversible(text) || latin1_count(text) < MIN_LATIN1_EVIDENCE {
        return text.to_string();
    }

    // ISO-8859-1 code point == byte value, so re-encoding is a cast.
    let bytes: Vec<u8> = text.chars().map(|c| c as u32 as u8).collect();

    let original_score = score(text);
    let mut best: Option<(i64, String)> = None;
    for encoding in CANDIDATES {
        let (decoded, _, had_errors) = encoding.decode(&bytes);
        if had_errors {
            continue;
        }
        let decoded = decoded.into_owned();
        // Confidence bias: random CJK bytes are extremely unlikely to form
        // *valid* UTF-8 (its multi-byte structure is self-checking), and a
        // valid UTF-8 sequence usually decodes to fewer characters than a
        // 2-byte encoding would, so raw score comparison under-rates it.
        let bias = if encoding == UTF_8 { UTF8_BONUS } else { 0 };
        let score = score(&decoded) + bias;
        // Strictly-greater keeps the earlier (preferred) encoding on ties.
        if score > original_score && best.as_ref().is_none_or(|(s, _)| score > *s) {
            best = Some((score, decoded));
        }
    }

    best.map(|(_, text)| text).unwrap_or_else(|| text.to_string())
}

/// True when every char maps back to a single Latin-1 byte.
fn is_latin1_reversible(text: &str) -> bool {
    text.chars().all(|c| (c as u32) <= 0xFF)
}

fn is_latin1_supp(c: char) -> bool {
    matches!(c, '\u{00A0}'..='\u{00FF}')
}

fn is_bad_char(c: char) -> bool {
    c == '\u{FFFD}' || matches!(c, '\u{0080}'..='\u{009F}')
}

fn latin1_count(text: &str) -> usize {
    text.chars().filter(|c| is_latin1_supp(*c) || is_bad_char(*c)).count()
}

/// Higher is better. CJK content earns points; mojibake indicators cost more.
///
/// *Hiragana* is weighted above hanzi: the SJIS hiragana block (0x82xx lead
/// bytes) barely overlaps the GBK common-hanzi block (0xB0-0xF7 lead bytes),
/// and Japanese titles almost always contain hiragana particles. Katakana and
/// hangul get no extra weight: their byte ranges *do* overlap GBK hanzi, so
/// they are not trustworthy signals (e.g. GBK `晴天` decodes to katakana
/// garbage under SJIS).
fn score(text: &str) -> i64 {
    let mut score: i64 = 0;
    for c in text.chars() {
        if is_bad_char(c) {
            score -= 10;
        } else if is_latin1_supp(c) {
            score -= 3;
        } else if is_hiragana(c) {
            score += 3;
        } else if is_cjk_ideograph(c) || is_cjk_punct(c) || is_katakana(c) || is_hangul(c) {
            score += 2;
        }
        // ASCII letters, digits, spaces and punctuation are neutral.
    }
    score
}

fn is_cjk_ideograph(c: char) -> bool {
    matches!(c, '\u{3400}'..='\u{4DBF}' | '\u{4E00}'..='\u{9FFF}' | '\u{F900}'..='\u{FAFF}')
}

fn is_cjk_punct(c: char) -> bool {
    matches!(c, '\u{3000}'..='\u{303F}' | '\u{FF01}'..='\u{FF5E}')
}

fn is_hiragana(c: char) -> bool {
    matches!(c, '\u{3040}'..='\u{309F}')
}

fn is_katakana(c: char) -> bool {
    matches!(c, '\u{30A0}'..='\u{30FF}')
}

fn is_hangul(c: char) -> bool {
    matches!(c, '\u{AC00}'..='\u{D7AF}' | '\u{1100}'..='\u{11FF}')
}

#[cfg(test)]
mod tests {
    use super::*;
    use encoding_rs::Encoding;

    /// Simulates the bug under repair: encode `text` with `encoding`, then
    /// misread the bytes as ISO-8859-1 (exactly what tag readers do).
    fn latin1_misread(text: &str, encoding: &'static Encoding) -> String {
        let (bytes, _, _) = encoding.encode(text);
        bytes.iter().map(|b| *b as char).collect()
    }

    #[test]
    fn gbk_mojibake_is_repaired_to_chinese() {
        let mojibake = latin1_misread("你好", &GB18030);
        assert_ne!(mojibake, "你好");
        assert_eq!(fix_mojibake(&mojibake), "你好");
    }

    #[test]
    fn gbk_mojibake_with_ascii_suffix_is_repaired() {
        let mojibake = latin1_misread("晴天 - Live", &GB18030);
        assert_eq!(fix_mojibake(&mojibake), "晴天 - Live");
    }

    #[test]
    fn fullwidth_punctuation_from_gbk_is_kept() {
        let mojibake = latin1_misread("后来(Live)", &GB18030);
        assert_eq!(fix_mojibake(&mojibake), "后来(Live)");
    }

    #[test]
    fn utf8_misread_as_latin1_is_repaired() {
        // UTF-8 bytes declared as Latin-1 (some tools do this on v2.4 tags).
        let mojibake = latin1_misread("音乐", &UTF_8);
        assert_eq!(fix_mojibake(&mojibake), "音乐");
    }

    #[test]
    fn western_titles_are_untouched() {
        for text in ["Café Del Mar", "Björk", "Mütter", "Il Divo feat. Édith"] {
            assert_eq!(fix_mojibake(text), text, "should not rewrite {text:?}");
        }
    }

    #[test]
    fn pure_ascii_and_valid_cjk_are_untouched() {
        for text in ["Track 01", "", "  ", "晴天", "Already 中文 fine"] {
            assert_eq!(fix_mojibake(text), text);
        }
    }

    #[test]
    fn single_accented_char_is_not_enough_evidence() {
        // One Latin-1 supplement char is normal Western text.
        assert_eq!(fix_mojibake("Tokyo Hotel à"), "Tokyo Hotel à");
    }

    #[test]
    fn non_reversible_text_is_untouched() {
        // Contains chars above U+00FF, so it cannot be a Latin-1 misread.
        assert_eq!(fix_mojibake("café™ 晴天"), "café™ 晴天");
    }

    #[test]
    fn japanese_shift_jis_is_repaired_when_gbk_fails() {
        let mojibake = latin1_misread("ありがとう", &SHIFT_JIS);
        // Whatever wins, the result must contain kana and no Latin-1 garbage.
        let fixed = fix_mojibake(&mojibake);
        assert!(
            fixed.chars().any(is_hiragana),
            "expected kana in {fixed:?} (from {mojibake:?})"
        );
    }
}

