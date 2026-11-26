import AVFoundation
import MediaPlayer
import Security
import Tauri
import UIKit
import WebKit

private struct OpenUrlArgs: Decodable {
    let url: String
}

private struct ControlArgs: Decodable {
    let action: String
    let value: Double?
    let session: String?
}

private struct SecureArgs: Decodable {
    let account: String
    let password: String?
}

private struct RecordUriArgs: Decodable {
    let uri: String
}

private struct RecordFileArgs: Decodable {
    let path: String
}

class MobilePlugin: Plugin {
    private weak var webview: WKWebView?
    private var originalBrightness: CGFloat?
    private var session: String?
    private let volumeView = MPVolumeView(frame: CGRect(x: -200, y: -200, width: 160, height: 40))
    private var fullscreenWasPortrait = false
    private var sniffer: MediaSniffer?

    @objc public override func load(webview: WKWebView) {
        self.webview = webview
        webview.allowsBackForwardNavigationGestures = true
        // The app shell handles env(safe-area-inset-*); UIKit must not inset it again.
        webview.scrollView.contentInsetAdjustmentBehavior = .never
        webview.scrollView.bounces = false
        volumeView.showsRouteButton = false
        NotificationCenter.default.addObserver(self, selector: #selector(background), name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(routeChanged(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
    }

    @objc private func background() {
        restore()
        volumeView.removeFromSuperview()
        session = nil
        webview?.evaluateJavaScript("document.dispatchEvent(new Event('kuriume-background'))", completionHandler: nil)
    }

    @objc private func interrupted(_ notification: Notification) {
        if notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt == AVAudioSession.InterruptionType.began.rawValue { background() }
    }

    @objc private func routeChanged(_ notification: Notification) {
        if notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { background() }
    }

    private func restore() {
        if let brightness = originalBrightness { UIScreen.main.brightness = brightness }
        originalBrightness = nil
        UIApplication.shared.isIdleTimerDisabled = false
        if session != nil { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    }

    @objc public func control(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ControlArgs.self)
        DispatchQueue.main.async { [self] in
            switch args.action {
            case "prepare":
                if volumeView.superview == nil { webview?.window?.addSubview(volumeView) }
                // Seeking/buffering can emit playing again; do not reset a gesture's brightness.
                if session != args.session || originalBrightness == nil {
                    restore()
                    session = args.session
                    originalBrightness = UIScreen.main.brightness
                    do {
                        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
                        try AVAudioSession.sharedInstance().setActive(true)
                    } catch { restore(); volumeView.removeFromSuperview(); session = nil; invoke.reject("Audio session unavailable"); return }
                }
                UIApplication.shared.isIdleTimerDisabled = true
            case "pause":
                if args.session == session { UIApplication.shared.isIdleTimerDisabled = false }
            case "volume", "brightness":
                guard args.session == session, let value = args.value, value.isFinite, (0...1).contains(value) else {
                    invoke.reject("Player session expired"); return
                }
                if args.action == "brightness" {
                    if originalBrightness == nil { originalBrightness = UIScreen.main.brightness }
                    UIScreen.main.brightness = CGFloat(max(0.05, value))
                } else {
                    // outputVolume is read-only. Drive the public system volume control.
                    guard let slider = volumeView.subviews.compactMap({ $0 as? UISlider }).first else {
                        invoke.reject("System volume control unavailable"); return
                    }
                    slider.setValue(Float(value), animated: false)
                    slider.sendActions(for: .touchUpInside)
                }
            case "finish":
                if args.session == session { restore(); volumeView.removeFromSuperview(); session = nil }
            case "fullscreen":
                if #available(iOS 16.0, *), UIDevice.current.userInterfaceIdiom == .phone,
                   let scene = webview?.window?.windowScene {
                    let enter = args.value == 1
                    if enter { fullscreenWasPortrait = scene.interfaceOrientation.isPortrait }
                    let orientation: UIInterfaceOrientationMask = enter ? .landscape : (fullscreenWasPortrait ? .portrait : .allButUpsideDown)
                    manager.viewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
                    scene.requestGeometryUpdate(.iOS(interfaceOrientations: orientation)) { _ in
                        // Rotation may be denied in multitasking; immersive layout still works.
                    }
                }
            case "levels", "leave": break
            default: invoke.reject("Unknown player control"); return
            }
            invoke.resolve(["volume": Double(AVAudioSession.sharedInstance().outputVolume), "brightness": Double(UIScreen.main.brightness)])
        }
    }

    @objc public func sniff(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SniffArgs.self)
        DispatchQueue.main.async { [self] in
            sniffer?.cancel()
            sniffer = MediaSniffer(args: args, invoke: invoke)
            sniffer?.start(in: webview)
        }
    }

    /// Opens a link in Safari (release pages).
    @objc public func openUrl(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(OpenUrlArgs.self)
        guard let url = URL(string: args.url) else {
            invoke.reject("Invalid link")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url) { opened in
                if opened { invoke.resolve() } else { invoke.reject("No app can open this link") }
            }
        }
    }


    // MARK: - Stored password

    private let keychainService = "kuriume-webdav"

    private func keychainQuery(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
        ]
    }

    @objc public func secureGet(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SecureArgs.self)
        var query = keychainQuery(args.account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            invoke.resolve([:])
            return
        }
        guard status == errSecSuccess, let data = item as? Data, let password = String(data: data, encoding: .utf8) else {
            invoke.reject("Secure storage unavailable")
            return
        }
        invoke.resolve(["password": password])
    }

    @objc public func secureSet(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SecureArgs.self)
        guard let password = args.password, !password.isEmpty else {
            invoke.reject("Password is empty")
            return
        }
        SecItemDelete(keychainQuery(args.account) as CFDictionary)
        var attributes = keychainQuery(args.account)
        attributes[kSecValueData as String] = Data(password.utf8)
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        if status == errSecSuccess { invoke.resolve() } else { invoke.reject("Secure storage unavailable") }
    }

    @objc public func secureClear(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SecureArgs.self)
        let status = SecItemDelete(keychainQuery(args.account) as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound { invoke.resolve() } else { invoke.reject("Secure storage unavailable") }
    }

    // MARK: - Records files

    private func recordsFolder() -> URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("records", isDirectory: true)
    }

    @objc public func readRecordUri(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(RecordUriArgs.self)
        let parsed = URL(string: args.uri)
        let url: URL
        if let parsed, parsed.isFileURL {
            url = parsed
        } else if args.uri.hasPrefix("/") {
            url = URL(fileURLWithPath: args.uri)
        } else {
            invoke.reject("Cannot read this file")
            return
        }
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        let manager = FileManager.default
        do {
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            if size > 32 * 1024 * 1024 {
                invoke.reject("The file is larger than 32 MB")
                return
            }
            let folder = manager.urls(for: .cachesDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("imports", isDirectory: true)
            try manager.createDirectory(at: folder, withIntermediateDirectories: true)
            let target = folder.appendingPathComponent("records-\(Int(Date().timeIntervalSince1970)).json")
            try? manager.removeItem(at: target)
            try manager.copyItem(at: url, to: target)
            invoke.resolve(["path": target.path])
        } catch {
            invoke.reject("Cannot read this file: \(error.localizedDescription)")
        }
    }

    @objc public func shareRecordFile(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(RecordFileArgs.self)
        let file = URL(fileURLWithPath: args.path).standardizedFileURL
        let folder = recordsFolder().standardizedFileURL
        guard file.deletingLastPathComponent().path == folder.path, file.pathExtension == "json",
              FileManager.default.fileExists(atPath: file.path) else {
            invoke.reject("Not a records file")
            return
        }
        DispatchQueue.main.async { [self] in
            let controller = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            if let popover = controller.popoverPresentationController, let webview = webview {
                popover.sourceView = webview
                popover.sourceRect = CGRect(x: webview.bounds.midX, y: webview.bounds.midY, width: 1, height: 1)
            }
            guard let presenter = manager.viewController ?? webview?.window?.rootViewController else {
                invoke.reject("No window to share from")
                return
            }
            presenter.present(controller, animated: true) { invoke.resolve() }
        }
    }

    deinit { NotificationCenter.default.removeObserver(self) }
}

@_cdecl("init_plugin_mobile")
func initPlugin() -> Plugin { MobilePlugin() }
