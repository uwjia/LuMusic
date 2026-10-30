//! Binary entry point. All logic lives in the library crate so it stays testable.

// Hide the console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lumusic_lib::run();
}
