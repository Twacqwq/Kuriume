// 新式模块声明：commands.rs + commands/ 目录配对，无需 mod.rs
// 子模块必须 pub，Tauri 的 generate_handler! 宏需要访问 #[tauri::command] 生成的隐藏符号
pub mod anime;
pub mod greet;

// 统一 re-export 状态类型，方便 lib.rs 使用
pub use anime::ProviderState;
