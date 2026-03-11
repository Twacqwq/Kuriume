fn main() {
    // Tell the linker where to find libmpv (Homebrew on macOS ARM)
    if cfg!(target_os = "macos") {
        println!("cargo:rustc-link-search=native=/opt/homebrew/lib");
    }

    tauri_build::build()
}
