package com.twac.kuriume.mobile

import android.app.Activity
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.*
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke

@InvokeArg
class SniffArgs {
    lateinit var url: String
    var allowedHosts: List<String> = emptyList()
    var userAgent: String? = null
    lateinit var script: String
}

class MediaSniffer(private val activity: Activity, private val args: SniffArgs, private var invoke: Invoke?) {
    private val handler = Handler(Looper.getMainLooper())
    private var view: WebView? = null
    private val urls = linkedSetOf<String>()
    private val timeout = Runnable { finish() }
    private val settle = Runnable { finish() }
    private fun allowed(uri: Uri): Boolean {
        if (uri.scheme == "about") return uri.schemeSpecificPart in listOf("blank", "srcdoc")
        val host = uri.host?.lowercase() ?: return false
        return uri.scheme in listOf("http", "https") && args.allowedHosts.any { host == it.lowercase() || host.endsWith("." + it.lowercase()) }
    }
    private fun candidate(value: String) {
        if (invoke == null || value.length > 8192 || Uri.parse(value).scheme !in listOf("http", "https") || urls.size >= 16 || !urls.add(value)) return
        handler.removeCallbacks(settle)
        handler.postDelayed(settle, 2000)
    }
    fun start() {
        if (!allowed(Uri.parse(args.url))) { finish(); return }
        val web = WebView(activity)
        view = web
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.settings.setSupportMultipleWindows(true)
        args.userAgent?.let { web.settings.userAgentString = it }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        web.webChromeClient = object : WebChromeClient() {
            override fun onReceivedTitle(view: WebView?, title: String?) {
                title?.takeIf { it.startsWith("__KURIUME_MEDIA__:") }?.let { candidate(it.removePrefix("__KURIUME_MEDIA__:")) }
            }
            override fun onCreateWindow(view: WebView?, isDialog: Boolean, isUserGesture: Boolean, resultMsg: android.os.Message?): Boolean = false
            override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = !allowed(request.url)
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                if (url == null || !allowed(Uri.parse(url))) { view.stopLoading(); return }
                view.evaluateJavascript(args.script, null)
            }
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val value = request.url.toString()
                if (Regex("\\.m3u8(?:[?#]|$)", RegexOption.IGNORE_CASE).containsMatchIn(value)) {
                    activity.runOnUiThread { candidate(value) }
                }
                return null
            }
        }
        // Modern WebView injects into child frames as well; network HLS capture
        // remains available on older engines without the document-start API.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(web, args.script, setOf("*"))
        }
        handler.postDelayed(timeout, 28000)
        web.loadUrl(args.url)
    }
    fun cancel() { urls.clear(); finish() }
    private fun finish() {
        val current = invoke ?: return
        invoke = null
        handler.removeCallbacks(timeout); handler.removeCallbacks(settle)
        view?.stopLoading(); view?.destroy(); view = null
        current.resolveObject(urls.toList())
    }
}
