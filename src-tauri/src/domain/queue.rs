//! Play queue: ordering, shuffle, repeat and navigation rules.
//!
//! The queue keeps two views:
//! - `items`: the playlist order (what the user sees);
//! - `play_order`: the playback sequence as indices into `items`.
//! Shuffle only rewrites `play_order`, so switching it off restores the
//! original order without losing the current track.

use rand::seq::SliceRandom;
use rand::SeedableRng;
use serde::{Deserialize, Serialize};

use super::track::TrackId;

/// Repeat behavior for the queue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum RepeatMode {
    /// Stop after the last track.
    #[default]
    Off,
    /// Repeat the whole queue.
    All,
    /// Repeat the current track (only on automatic advance).
    One,
}

/// What `advance` decided to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdvanceOutcome {
    /// Play this track next.
    Playing(TrackId),
    /// End of queue reached (repeat off) - playback should stop.
    Stopped,
}

/// Why [`Queue::remove_item`] refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoveError {
    /// No item lives at that index.
    OutOfRange,
    /// The index names the track that is playing right now; removing it
    /// would leave the engine playing a track the queue no longer knows.
    CurrentTrack,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Queue {
    items: Vec<TrackId>,
    play_order: Vec<usize>,
    /// Index into `play_order` of the current (or last played) position.
    position: Option<usize>,
    shuffle: bool,
    repeat: RepeatMode,
}

impl Queue {
    /// Creates a queue over `items`, starting at `start` (index into `items`).
    /// An empty `items` list yields an idle queue.
    pub fn new(items: Vec<TrackId>, start: Option<usize>) -> Self {
        let mut queue = Self {
            items,
            play_order: Vec::new(),
            position: None,
            shuffle: false,
            repeat: RepeatMode::Off,
        };
        queue.play_order = (0..queue.items.len()).collect();
        if !queue.items.is_empty() {
            queue.position = Some(start.unwrap_or(0).min(queue.items.len() - 1));
        }
        queue
    }

    /// Replaces the queue contents (keeping modes) and jumps to `start`.
    pub fn set_items(&mut self, items: Vec<TrackId>, start: Option<usize>) {
        self.items = items;
        self.position = None;
        self.rebuild_order(0);
        if !self.items.is_empty() {
            self.position = Some(start.unwrap_or(0).min(self.items.len() - 1));
        }
    }

    /// Appends tracks to the queue's tail without touching the current
    /// position: sequential play continues into them after the existing
    /// tracks; under shuffle the new indices are shuffled and queued after
    /// everything not yet played, so nothing replays and nothing is skipped
    /// (a full rebuild would re-deal already-played tracks before them).
    pub fn append(&mut self, new_items: Vec<TrackId>, shuffle_seed: u64) {
        if new_items.is_empty() {
            return;
        }
        let start = self.items.len();
        self.items.extend(new_items);
        let mut new_order: Vec<usize> = (start..self.items.len()).collect();
        if self.shuffle {
            let mut rng = rand::rngs::StdRng::seed_from_u64(shuffle_seed);
            new_order.shuffle(&mut rng);
        }
        self.play_order.extend(new_order);
    }

    pub fn items(&self) -> &[TrackId] {
        &self.items
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn shuffle(&self) -> bool {
        self.shuffle
    }

    pub fn repeat(&self) -> RepeatMode {
        self.repeat
    }

    pub fn set_repeat(&mut self, repeat: RepeatMode) {
        self.repeat = repeat;
    }

    /// Toggles shuffle. The current track always becomes the first entry of the
    /// shuffled sequence so playback continues through the remaining tracks.
    /// `seed` makes the shuffle deterministic (testability).
    pub fn set_shuffle(&mut self, on: bool, seed: u64) {
        self.shuffle = on;
        self.rebuild_order(seed);
    }

    fn rebuild_order(&mut self, seed: u64) {
        let mut order: Vec<usize> = (0..self.items.len()).collect();
        if self.shuffle {
            let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
            order.shuffle(&mut rng);
            if let Some(current_item) = self.current_item_index() {
                // Move the current item to the front of the play sequence.
                let pos = order
                    .iter()
                    .position(|i| *i == current_item)
                    .expect("current item must be in order");
                order.swap(0, pos);
                self.play_order = order;
                self.position = Some(0);
                return;
            }
        } else if let Some(current_item) = self.current_item_index() {
            self.play_order = order;
            self.position = Some(current_item);
            return;
        }
        self.play_order = order;
        if self.play_order.is_empty() {
            self.position = None;
        }
    }

    /// Index into `items` of the current track.
    pub fn current_item_index(&self) -> Option<usize> {
        self.position.and_then(|p| self.play_order.get(p)).copied()
    }

    /// Id of the current track, if any.
    pub fn current(&self) -> Option<TrackId> {
        self.current_item_index()
            .and_then(|i| self.items.get(i))
            .cloned()
    }

    /// Inserts `id` as the *next* track to play: right after the current
    /// item in the visible order, and right after the current position in
    /// the play sequence (so it really is next under shuffle too). An idle
    /// queue becomes a one-track queue positioned on the new track.
    ///
    /// Both views stay consistent permutations: inserting into `items`
    /// shifts later indices up, so `play_order` is remapped before the new
    /// index is spliced in.
    pub fn insert_next(&mut self, id: TrackId) {
        let item_at = self.current_item_index().map(|c| c + 1).unwrap_or(0);
        for index in self.play_order.iter_mut() {
            if *index >= item_at {
                *index += 1;
            }
        }
        self.items.insert(item_at, id);
        let play_at = self.position.map(|p| p + 1).unwrap_or(0);
        self.play_order.insert(play_at.min(self.play_order.len()), item_at);
        if self.position.is_none() {
            // Idle queue: the inserted track is now the current one.
            self.position = Some(0);
        }
    }

    /// Removes the item at `item_index` from both views. Removing the
    /// current track is rejected (see [`RemoveError::CurrentTrack`]);
    /// removing an unplayed item keeps the current track and every
    /// already-played entry reachable from the same position.
    pub fn remove_item(&mut self, item_index: usize) -> Result<(), RemoveError> {
        if item_index >= self.items.len() {
            return Err(RemoveError::OutOfRange);
        }
        if self.current_item_index() == Some(item_index) {
            return Err(RemoveError::CurrentTrack);
        }
        self.items.remove(item_index);
        // Rebuild the play order without the removed item, remembering
        // where it sat so the cursor can be corrected.
        let mut removed_at = None;
        let mut order = Vec::with_capacity(self.play_order.len().saturating_sub(1));
        for (slot, &index) in self.play_order.iter().enumerate() {
            if index == item_index {
                removed_at = Some(slot);
                continue;
            }
            order.push(if index > item_index { index - 1 } else { index });
        }
        self.play_order = order;
        if let (Some(removed_slot), Some(position)) = (removed_at, self.position) {
            if removed_slot < position {
                self.position = Some(position - 1);
            }
        }
        Ok(())
    }

    /// Jumps to an arbitrary index into `items`.
    pub fn jump_to_item(&mut self, item_index: usize) -> Option<TrackId> {
        if item_index >= self.items.len() {
            return None;
        }
        let pos = self
            .play_order
            .iter()
            .position(|i| *i == item_index)
            .expect("play_order is a permutation of item indices");
        self.position = Some(pos);
        self.current()
    }

    /// Advances one track.
    ///
    /// `auto == true` means the current track finished by itself (repeat One
    /// replays it); `auto == false` means the user pressed "next" (repeat One
    /// still advances).
    pub fn advance(&mut self, auto: bool) -> AdvanceOutcome {
        let Some(_current) = self.current() else {
            return AdvanceOutcome::Stopped;
        };
        if auto && self.repeat == RepeatMode::One {
            return AdvanceOutcome::Playing(self.current().expect("checked above"));
        }
        let Some(pos) = self.position else {
            return AdvanceOutcome::Stopped;
        };
        if pos + 1 < self.play_order.len() {
            self.position = Some(pos + 1);
            return AdvanceOutcome::Playing(self.current().expect("position is valid"));
        }
        // At the end of the sequence.
        match self.repeat {
            RepeatMode::All if !self.play_order.is_empty() => {
                self.position = Some(0);
                AdvanceOutcome::Playing(self.current().expect("position is valid"))
            }
            _ => AdvanceOutcome::Stopped,
        }
    }

    /// Goes back one track. Wraps to the end only when repeat is `All`;
    /// otherwise stays on the first track.
    pub fn previous(&mut self) -> Option<TrackId> {
        let pos = self.position?;
        if pos > 0 {
            self.position = Some(pos - 1);
        } else if self.repeat == RepeatMode::All && !self.play_order.is_empty() {
            self.position = Some(self.play_order.len() - 1);
        }
        self.current()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(n: usize) -> Vec<TrackId> {
        (0..n).map(|i| format!("t{i}")).collect()
    }

    #[test]
    fn new_with_empty_items_is_idle() {
        let mut q = Queue::new(vec![], None);
        assert!(q.is_empty());
        assert_eq!(q.current(), None);
        assert_eq!(q.advance(false), AdvanceOutcome::Stopped);
    }

    #[test]
    fn new_clamps_start_index_into_range() {
        let q = Queue::new(ids(3), Some(99));
        assert_eq!(q.current(), Some("t2".into()));
        let q = Queue::new(ids(3), None);
        assert_eq!(q.current(), Some("t0".into()));
    }

    #[test]
    fn sequential_advance_stops_at_end_with_repeat_off() {
        let mut q = Queue::new(ids(3), Some(0));
        assert_eq!(q.advance(false), AdvanceOutcome::Playing("t1".into()));
        assert_eq!(q.advance(false), AdvanceOutcome::Playing("t2".into()));
        assert_eq!(q.advance(false), AdvanceOutcome::Stopped);
        // Position stays on the last track so "prev" still works.
        assert_eq!(q.current(), Some("t2".into()));
    }

    #[test]
    fn repeat_all_wraps_around() {
        let mut q = Queue::new(ids(2), Some(1));
        q.set_repeat(RepeatMode::All);
        assert_eq!(q.advance(false), AdvanceOutcome::Playing("t0".into()));
        assert_eq!(q.advance(false), AdvanceOutcome::Playing("t1".into()));
    }

    #[test]
    fn repeat_one_replays_current_only_on_auto_advance() {
        let mut q = Queue::new(ids(3), Some(0));
        q.set_repeat(RepeatMode::One);
        // Track finished by itself: replay same track.
        assert_eq!(q.advance(true), AdvanceOutcome::Playing("t0".into()));
        // User pressed next: move on.
        assert_eq!(q.advance(false), AdvanceOutcome::Playing("t1".into()));
    }

    #[test]
    fn previous_walks_back_and_clamps_at_first() {
        let mut q = Queue::new(ids(3), Some(2));
        assert_eq!(q.previous(), Some("t1".into()));
        assert_eq!(q.previous(), Some("t0".into()));
        // Stays at the first track with repeat off.
        assert_eq!(q.previous(), Some("t0".into()));
    }

    #[test]
    fn previous_wraps_with_repeat_all() {
        let mut q = Queue::new(ids(3), Some(0));
        q.set_repeat(RepeatMode::All);
        assert_eq!(q.previous(), Some("t2".into()));
    }

    #[test]
    fn shuffle_is_deterministic_and_keeps_current_first() {
        let mut q = Queue::new(ids(5), Some(2));
        q.set_shuffle(true, 42);
        assert_eq!(q.current(), Some("t2".into()));
        // Same seed -> same sequence for a fresh queue in the same state.
        let mut q2 = Queue::new(ids(5), Some(2));
        q2.set_shuffle(true, 42);
        let seq = |q: &mut Queue| {
            (0..4)
                .map(|_| match q.advance(false) {
                    AdvanceOutcome::Playing(id) => id,
                    AdvanceOutcome::Stopped => panic!("unexpected stop"),
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(seq(&mut q), seq(&mut q2));
        // A fresh queue visits all five tracks exactly once.
        let mut q3 = Queue::new(ids(5), Some(2));
        q3.set_shuffle(true, 42);
        let mut all = vec![q3.current().unwrap()];
        all.extend(seq(&mut q3));
        let mut sorted = all.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), 5);
    }

    #[test]
    fn turning_shuffle_off_restores_playlist_position() {
        let mut q = Queue::new(ids(4), Some(2));
        q.set_shuffle(true, 7);
        assert_ne!(q.current_item_index(), None);
        q.set_shuffle(false, 7);
        assert_eq!(q.current(), Some("t2".into()));
        // Subsequent advance follows the playlist order again.
        assert_eq!(q.advance(false), AdvanceOutcome::Playing("t3".into()));
    }

    #[test]
    fn jump_to_item_selects_track_in_current_sequence() {
        let mut q = Queue::new(ids(3), Some(0));
        assert_eq!(q.jump_to_item(2), Some("t2".into()));
        assert_eq!(q.current_item_index(), Some(2));
        assert_eq!(q.jump_to_item(99), None);
    }

    #[test]
    fn set_items_replaces_content_keeping_modes() {
        let mut q = Queue::new(ids(3), Some(0));
        q.set_repeat(RepeatMode::All);
        q.set_items(vec!["x".into(), "y".into()], Some(1));
        assert_eq!(q.current(), Some("y".into()));
        assert_eq!(q.repeat(), RepeatMode::All);
        assert_eq!(q.advance(false), AdvanceOutcome::Playing("x".into()));
    }

    #[test]
    fn append_extends_a_sequential_queue_after_existing_tracks() {
        let mut q = Queue::new(ids(2), Some(0));
        q.append(vec!["t2".into(), "t3".into()], 42);
        assert_eq!(q.len(), 4);
        assert_eq!(q.advance(false), AdvanceOutcome::Playing("t1".into()));
        assert_eq!(q.advance(false), AdvanceOutcome::Playing("t2".into()));
        assert_eq!(q.advance(false), AdvanceOutcome::Playing("t3".into()));
        // Only after the appended tracks does repeat-off stop.
        assert_eq!(q.advance(false), AdvanceOutcome::Stopped);
    }

    #[test]
    fn append_under_shuffle_plays_every_track_exactly_once() {
        let mut q = Queue::new(ids(3), Some(1));
        q.set_shuffle(true, 7);
        q.append(vec!["n0".into(), "n1".into()], 9);
        assert_eq!(q.len(), 5);
        let mut played = vec![q.current().expect("current survives the append")];
        for _ in 0..4 {
            match q.advance(false) {
                AdvanceOutcome::Playing(id) => played.push(id),
                AdvanceOutcome::Stopped => panic!("appended queue must not stop early"),
            }
        }
        // Five distinct tracks: the three originals plus both appended ones.
        let mut distinct = played.clone();
        distinct.sort();
        distinct.dedup();
        assert_eq!(distinct.len(), 5);
        assert!(played.contains(&"n0".to_string()) && played.contains(&"n1".to_string()));
    }

    #[test]
    fn insert_next_plays_immediately_after_the_current_track() {
        let mut q = Queue::new(ids(3), Some(0)); // playing t0, next would be t1
        q.insert_next("x".into());
        assert_eq!(q.len(), 4);
        assert_eq!(q.current(), Some("t0".into()));
        assert_eq!(q.advance(false), AdvanceOutcome::Playing("x".into()));
        // The original order continues behind the insertion.
        assert_eq!(q.advance(false), AdvanceOutcome::Playing("t1".into()));
        assert_eq!(q.advance(false), AdvanceOutcome::Playing("t2".into()));
        assert_eq!(q.advance(false), AdvanceOutcome::Stopped);
    }

    #[test]
    fn insert_next_under_shuffle_is_really_next() {
        let mut q = Queue::new(ids(5), Some(2));
        q.set_shuffle(true, 42);
        q.insert_next("x".into());
        // Whatever the shuffled sequence is, the very next advance must
        // land on the inserted track, then continue the shuffled tail.
        assert_eq!(q.advance(false), AdvanceOutcome::Playing("x".into()));
        let rest = q.advance(false);
        assert_ne!(rest, AdvanceOutcome::Playing("x".into()));
        // In the visible order the track sits right after its anchor (t2).
        assert_eq!(q.items().iter().position(|i| i == "x"), Some(3));
    }

    #[test]
    fn insert_next_into_an_idle_queue_becomes_the_current_track() {
        let mut q = Queue::new(vec![], None);
        q.insert_next("only".into());
        assert_eq!(q.len(), 1);
        assert_eq!(q.current(), Some("only".into()));
        assert_eq!(q.advance(false), AdvanceOutcome::Stopped);
    }

    #[test]
    fn insert_next_from_the_last_position_appends_the_tail() {
        let mut q = Queue::new(ids(2), Some(1)); // on the last track
        q.insert_next("x".into());
        assert_eq!(q.advance(false), AdvanceOutcome::Playing("x".into()));
        assert_eq!(q.advance(false), AdvanceOutcome::Stopped);
    }

    #[test]
    fn remove_item_drops_the_track_and_keeps_the_rest_in_order() {
        let mut q = Queue::new(ids(4), Some(0));
        q.advance(false); // now on t1
        q.remove_item(2).unwrap(); // remove t2 (ahead of the cursor)
        assert_eq!(q.items(), &["t0".to_string(), "t1".to_string(), "t3".to_string()]);
        // t2 is gone from the sequence, everything else still reachable.
        let mut seen = vec![q.current().unwrap()];
        while let AdvanceOutcome::Playing(id) = q.advance(false) {
            seen.push(id);
        }
        assert_eq!(seen, vec!["t1".to_string(), "t3".to_string()]);
    }

    #[test]
    fn remove_item_behind_the_cursor_fixes_the_position() {
        let mut q = Queue::new(ids(3), Some(0));
        q.advance(false); // on t1; t0 was played and sits behind
        assert_eq!(q.current(), Some("t1".into()));
        q.remove_item(0).unwrap();
        // t1 keeps playing; with the played t0 gone it is now the first
        // track in the sequence, so prev clamps onto it.
        assert_eq!(q.current(), Some("t1".into()));
        assert_eq!(q.previous(), Some("t1".into()));
        // And "next" still walks the remaining tail.
        assert_eq!(q.advance(false), AdvanceOutcome::Playing("t2".into()));
    }

    #[test]
    fn remove_item_under_shuffle_keeps_every_remaining_track_reachable() {
        let mut q = Queue::new(ids(4), Some(1));
        q.set_shuffle(true, 7);
        // Remove whichever item is *not* current but is next in sequence.
        let current = q.current().unwrap();
        let next = match q.advance(false) {
            AdvanceOutcome::Playing(id) => id,
            AdvanceOutcome::Stopped => panic!("four-track queue cannot end here"),
        };
        q.previous(); // step back onto `current`
        assert_eq!(q.current(), Some(current));
        let remove_index = ["t0", "t1", "t2", "t3"]
            .iter()
            .position(|candidate| *candidate == next)
            .unwrap();
        q.remove_item(remove_index).unwrap();
        // The removed track must never come back; the rest must all play.
        let mut played = vec![q.current().unwrap()];
        while let AdvanceOutcome::Playing(id) = q.advance(false) {
            assert_ne!(id, next, "removed track must not replay");
            played.push(id);
        }
        let mut distinct = played.clone();
        distinct.sort();
        distinct.dedup();
        assert_eq!(distinct.len(), 3, "every remaining track plays once");
    }

    #[test]
    fn remove_item_rejects_out_of_range_and_the_current_track() {
        let mut q = Queue::new(ids(3), Some(1));
        assert_eq!(q.remove_item(3), Err(RemoveError::OutOfRange));
        assert_eq!(q.current_item_index(), Some(1));
        assert_eq!(q.remove_item(1), Err(RemoveError::CurrentTrack));
        // Refusals mutate nothing.
        assert_eq!(q.len(), 3);
        assert_eq!(q.current(), Some("t1".into()));
    }

    #[test]
    fn remove_item_on_an_idle_queue_is_out_of_range() {
        let mut q = Queue::new(vec![], None);
        assert_eq!(q.remove_item(0), Err(RemoveError::OutOfRange));
    }
}
