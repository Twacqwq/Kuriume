import Tauri
import WebKit

struct SniffArgs: Decodable {
    let url: String
    let allowedHosts: [String]
    let userAgent: String?
    let script: String
}

// An isolated, ephemeral resolver: no Tauri bridge, popups, downloads or UI.
final class MediaSniffer: NSObject, WKNavigationDelegate, WKUIDelegate {
    private let args: SniffArgs
    private var invoke: Invoke?
    private var view: WKWebView?
    private var observation: NSKeyValueObservation?
    private var timeout: DispatchWorkItem?
    private var settle: DispatchWorkItem?
    private var urls: [String] = []

    init(args: SniffArgs, invoke: Invoke) { self.args = args; self.invoke = invoke }

    func start(in parent: WKWebView?) {
        guard let url = URL(string: args.url), allowed(url) else { cancel(); return }
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.addUserScript(WKUserScript(source: args.script, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        let view = WKWebView(frame: CGRect(x: -1024, y: -1024, width: 800, height: 450), configuration: config)
        self.view = view
        view.customUserAgent = args.userAgent
        view.navigationDelegate = self
        view.uiDelegate = self
        view.isUserInteractionEnabled = false
        parent?.addSubview(view)
        observation = view.observe(\.title, options: [.new]) { [weak self] view, _ in
            guard let self = self, let title = view.title, title.hasPrefix("__KURIUME_MEDIA__:") else { return }
            let candidate = String(title.dropFirst("__KURIUME_MEDIA__:".count))
            guard candidate.count <= 8192, let url = URL(string: candidate), ["http", "https"].contains(url.scheme ?? ""), !self.urls.contains(candidate), self.urls.count < 16 else { return }
            self.urls.append(candidate)
            self.settle?.cancel()
            let settle = DispatchWorkItem { [weak self] in self?.finish() }
            self.settle = settle
            DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: settle)
        }
        let timeout = DispatchWorkItem { [weak self] in self?.finish() }
        self.timeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 28, execute: timeout)
        view.load(URLRequest(url: url))
    }

    private func allowed(_ url: URL) -> Bool {
        if url.scheme == "about" { return ["blank", "srcdoc"].contains(url.path) }
        guard ["http", "https"].contains(url.scheme ?? ""), let host = url.host?.lowercased() else { return false }
        return args.allowedHosts.contains { host == $0.lowercased() || host.hasSuffix("." + $0.lowercased()) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, allowed(url), navigationAction.targetFrame != nil else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

    func cancel() { urls = []; finish() }
    private func finish() {
        guard let invoke = invoke else { return }
        self.invoke = nil
        timeout?.cancel(); settle?.cancel(); observation?.invalidate()
        view?.stopLoading(); view?.removeFromSuperview(); view = nil
        invoke.resolve(urls)
    }
}
