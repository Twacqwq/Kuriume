package com.twac.kuriume.mobile

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.media.AudioManager
import android.net.Uri
import android.provider.Settings
import android.view.WindowManager
import android.webkit.WebView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import kotlin.math.roundToInt

@InvokeArg
class OpenUrlArgs { lateinit var url: String }

@InvokeArg
class ControlArgs { lateinit var action: String; var value: Double? = null; var session: String? = null }

@TauriPlugin
class MobilePlugin(private val activity: Activity) : Plugin(activity) {
    private val audio = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var originalBrightness: Float? = null
    private var session: String? = null
    private var previousOrientation: Int? = null
    private var view: WebView? = null
    private var sniffer: MediaSniffer? = null

    override fun load(webView: WebView) { view = webView; activity.volumeControlStream = AudioManager.STREAM_MUSIC }
    private fun brightness(): Double {
        val current = activity.window.attributes.screenBrightness
        return if (current >= 0) current.toDouble() else
            Settings.System.getInt(activity.contentResolver, Settings.System.SCREEN_BRIGHTNESS, 128) / 255.0
    }
    private fun restore() {
        originalBrightness?.let { original -> activity.window.attributes = activity.window.attributes.apply { screenBrightness = original } }
        originalBrightness = null
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
    private fun background() {
        restore()
        session = null
        view?.evaluateJavascript("document.dispatchEvent(new Event('kuriume-background'))", null)
    }
    override fun onPause() { background() }
    override fun onDestroy() { restore(); sniffer?.cancel() }

    @Command
    fun control(invoke: Invoke) {
        val args = invoke.parseArgs(ControlArgs::class.java)
        activity.runOnUiThread {
            try {
                when (args.action) {
                    "prepare" -> {
                        // Chromium owns audio focus for the HTML video. A second
                        // native owner steals it from WebView, or mistakes the
                        // video's own focus gain for backgrounding and pauses it.
                        if (session != args.session || originalBrightness == null) {
                            restore(); session = args.session
                            originalBrightness = activity.window.attributes.screenBrightness
                        }
                        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    }
                    "pause" -> if (args.session == session) activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    "volume", "brightness" -> {
                        val value = args.value
                        if (args.session != session || value == null || !value.isFinite() || value !in 0.0..1.0) {
                            invoke.reject("Player session expired"); return@runOnUiThread
                        }
                        if (args.action == "volume") {
                            if (audio.isVolumeFixed) { invoke.reject("System volume is fixed"); return@runOnUiThread }
                            audio.setStreamVolume(AudioManager.STREAM_MUSIC, (value * audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)).roundToInt(), 0)
                        } else {
                            if (originalBrightness == null) originalBrightness = activity.window.attributes.screenBrightness
                            activity.window.attributes = activity.window.attributes.apply { screenBrightness = value.coerceAtLeast(0.05).toFloat() }
                        }
                    }
                    "finish" -> if (args.session == session) { restore(); session = null }
                    "fullscreen" -> {
                        val controller = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
                        if (args.value == 1.0) {
                            if (previousOrientation == null) previousOrientation = activity.requestedOrientation
                            // Tablets/multi-window keep their current orientation.
                            if (activity.resources.configuration.smallestScreenWidthDp < 600 && !activity.isInMultiWindowMode) {
                                activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                            }
                            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                            controller.hide(WindowInsetsCompat.Type.systemBars())
                        } else {
                            controller.show(WindowInsetsCompat.Type.systemBars())
                            previousOrientation?.let { activity.requestedOrientation = it }
                            previousOrientation = null
                        }
                    }
                    "levels" -> Unit
                    "leave" -> activity.moveTaskToBack(true)
                    else -> { invoke.reject("Unknown player control"); return@runOnUiThread }
                }
                invoke.resolve(JSObject().apply {
                    put("volume", audio.getStreamVolume(AudioManager.STREAM_MUSIC).toDouble() / audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1))
                    put("brightness", brightness())
                })
            } catch (error: Exception) { invoke.reject("Device control unavailable: ${error.message}") }
        }
    }

    @Command
    fun sniff(invoke: Invoke) {
        val args = invoke.parseArgs(SniffArgs::class.java)
        activity.runOnUiThread {
            sniffer?.cancel()
            sniffer = MediaSniffer(activity, args, invoke)
            sniffer?.start()
        }
    }

    /** Opens a link in the system browser (release pages and APK downloads). */
    @Command
    fun openUrl(invoke: Invoke) {
        val args = invoke.parseArgs(OpenUrlArgs::class.java)
        activity.runOnUiThread {
            try {
                activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(args.url)))
                invoke.resolve()
            } catch (error: ActivityNotFoundException) {
                invoke.reject("No app can open this link")
            }
        }
    }
}
