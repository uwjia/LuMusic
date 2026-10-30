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
        self.current_item_index().and_then(|i| self.items.get(i)).cloned()
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
}
