import AVFoundation
import MediaPlayer
import Tauri
import UIKit
import WebKit

private struct ControlArgs: Decodable {
    let action: String
    let value: Double?
    let session: String?
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

    deinit { NotificationCenter.default.removeObserver(self) }
}

@_cdecl("init_plugin_mobile")
func initPlugin() -> Plugin { MobilePlugin() }
