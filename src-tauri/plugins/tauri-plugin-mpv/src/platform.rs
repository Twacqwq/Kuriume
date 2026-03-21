//! Platform-specific native video view implementations.

#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(target_os = "macos")]
pub use macos::NativeVideoView;
