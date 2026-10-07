fn main() {
    tauri_plugin::Builder::new(&["control"])
        .android_path("android")
        .ios_path("ios")
        .build();
}
