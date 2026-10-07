// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "tauri-plugin-mobile",
    platforms: [.iOS(.v14)],
    products: [.library(name: "tauri-plugin-mobile", type: .static, targets: ["tauri-plugin-mobile"])],
    dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
    targets: [.target(name: "tauri-plugin-mobile", dependencies: [.byName(name: "Tauri")], path: "Sources")]
)
