//! Platform-specific native video view implementations.

#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(target_os = "macos")]
pub use macos::NativeVideoView;

#[cfg(target_os = "windows")]
pub mod windows;

#[cfg(target_os = "windows")]
pub use windows::NativeVideoView;

#[cfg(target_os = "android")]
pub mod android;

#[cfg(target_os = "android")]
pub use android::NativeVideoView;

#[cfg(target_os = "ios")]
pub mod ios;

#[cfg(target_os = "ios")]
pub use ios::NativeVideoView;
