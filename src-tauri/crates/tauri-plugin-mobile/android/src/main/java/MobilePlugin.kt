package com.twac.kuriume.mobile

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.view.WindowManager
import android.webkit.WebView
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlin.math.roundToInt

@InvokeArg
class OpenUrlArgs { lateinit var url: String }

@InvokeArg
class InstallPackageArgs { lateinit var path: String }

@InvokeArg
class ControlArgs { lateinit var action: String; var value: Double? = null; var session: String? = null }

@InvokeArg
class SecureArgs { lateinit var account: String; var password: String? = null }

@InvokeArg
class RecordUriArgs { lateinit var uri: String }

@InvokeArg
class RecordFileArgs { lateinit var path: String }

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

    /** Update packages are downloaded here; UpdateFileProvider shares only this folder. */
    private fun updateFolder() = File(activity.cacheDir, "updates")

    /**
     * Android 8+ asks once whether Kuriume may install apps. Without that,
     * open the setting and report INSTALL_PERMISSION_REQUIRED (src-tauri/src/app_update.rs).
     */
    private fun ensureInstallPermission(invoke: Invoke): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || activity.packageManager.canRequestPackageInstalls()) return true
        activity.runOnUiThread {
            try {
                activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
            } catch (ignored: ActivityNotFoundException) {
                // The user can still allow it from the system settings.
            }
        }
        invoke.reject("INSTALL_PERMISSION_REQUIRED")
        return false
    }

    /** An empty folder for the next update package; asks for install permission first. */
    @Command
    fun updateDir(invoke: Invoke) {
        if (!ensureInstallPermission(invoke)) return
        val dir = updateFolder()
        // One package at a time: earlier downloads are no longer needed.
        dir.listFiles()?.forEach { it.delete() }
        if (!dir.isDirectory && !dir.mkdirs()) { invoke.reject("Cannot create the update folder"); return }
        invoke.resolve(JSObject().apply { put("path", dir.absolutePath) })
    }

    /** Opens the system installer for a verified package in [updateFolder]. */
    @Command
    fun installPackage(invoke: Invoke) {
        val args = invoke.parseArgs(InstallPackageArgs::class.java)
        val file = File(args.path)
        if (file.parentFile?.canonicalPath != updateFolder().canonicalPath || !file.isFile || !file.name.endsWith(".apk")) {
            invoke.reject("Not a downloaded update package"); return
        }
        if (!ensureInstallPermission(invoke)) return
        activity.runOnUiThread {
            try {
                val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.kuriume.updates", file)
                val intent = Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                activity.startActivity(intent)
                invoke.resolve()
            } catch (error: Exception) {
                invoke.reject("Cannot open the installer: ${error.message}")
            }
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

    private val securePrefs by lazy { activity.getSharedPreferences("kuriume-secure", Context.MODE_PRIVATE) }

    /** AES key in the AndroidKeyStore; the preferences only hold ciphertext. */
    private fun secureKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getEntry(SECURE_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(SECURE_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    @Command
    fun secureGet(invoke: Invoke) {
        val args = invoke.parseArgs(SecureArgs::class.java)
        val stored = securePrefs.getString(args.account, null)
        if (stored == null) { invoke.resolve(JSObject()); return }
        try {
            val raw = Base64.decode(stored, Base64.NO_WRAP)
            if (raw.size <= 12) { invoke.reject("Stored password is damaged"); return }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secureKey(), GCMParameterSpec(128, raw, 0, 12))
            val password = String(cipher.doFinal(raw, 12, raw.size - 12), Charsets.UTF_8)
            invoke.resolve(JSObject().apply { put("password", password) })
        } catch (error: Exception) {
            invoke.reject("Secure storage unavailable: ${error.message}")
        }
    }

    @Command
    fun secureSet(invoke: Invoke) {
        val args = invoke.parseArgs(SecureArgs::class.java)
        val password = args.password
        if (password.isNullOrEmpty()) { invoke.reject("Password is empty"); return }
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, secureKey())
            val payload = ByteArrayOutputStream()
            payload.write(cipher.iv)
            payload.write(cipher.doFinal(password.toByteArray(Charsets.UTF_8)))
            val encoded = Base64.encodeToString(payload.toByteArray(), Base64.NO_WRAP)
            if (!securePrefs.edit().putString(args.account, encoded).commit()) {
                invoke.reject("Secure storage is read-only"); return
            }
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject("Secure storage unavailable: ${error.message}")
        }
    }

    @Command
    fun secureClear(invoke: Invoke) {
        val args = invoke.parseArgs(SecureArgs::class.java)
        securePrefs.edit().remove(args.account).apply()
        invoke.resolve()
    }

    /** Records shared with other apps come from this one folder. */
    private fun recordsFolder() = File(activity.cacheDir, "records")

    /** Copies a picked document into the app cache so Rust can read a plain path. */
    @Command
    fun readRecordUri(invoke: Invoke) {
        val args = invoke.parseArgs(RecordUriArgs::class.java)
        val uri = try {
            val parsed = Uri.parse(args.uri)
            if (parsed.scheme == null && args.uri.startsWith("/")) Uri.fromFile(File(args.uri)) else parsed
        } catch (error: Exception) { invoke.reject("Cannot read this file"); return }
        if (uri.scheme != "content" && uri.scheme != "file") { invoke.reject("Cannot read this file"); return }
        val folder = File(activity.cacheDir, "imports")
        if (!folder.isDirectory && !folder.mkdirs()) { invoke.reject("Cannot create the import folder"); return }
        val target = File(folder, "records-${System.currentTimeMillis()}.json")
        try {
            activity.contentResolver.openInputStream(uri).use { input ->
                if (input == null) { invoke.reject("Cannot read this file"); return }
                target.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var total = 0L
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        total += read
                        if (total > MAX_RECORD_BYTES) {
                            target.delete()
                            invoke.reject("The file is larger than 32 MB")
                            return
                        }
                        output.write(buffer, 0, read)
                    }
                }
            }
            invoke.resolve(JSObject().apply { put("path", target.absolutePath) })
        } catch (error: Exception) {
            target.delete()
            invoke.reject("Cannot read this file: ${error.message}")
        }
    }

    /** Saves a records file into the public Downloads folder. */
    @Command
    fun saveRecordFile(invoke: Invoke) {
        val args = invoke.parseArgs(RecordFileArgs::class.java)
        val file = File(args.path)
        if (file.parentFile?.canonicalPath != recordsFolder().canonicalPath || !file.isFile || !file.name.endsWith(".json")) {
            invoke.reject("Not a records file"); return
        }
        activity.runOnUiThread {
            try {
                val location = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    saveToPublicDownloads(file)
                } else {
                    saveToAppDownloads(file)
                }
                invoke.resolve(JSObject().apply { put("location", location) })
            } catch (error: Exception) {
                invoke.reject("Cannot save the file: ${error.message}")
            }
        }
    }

    /** Android 10+ writes through MediaStore, so no storage permission is needed. */
    private fun saveToPublicDownloads(file: File): String {
        val resolver = activity.contentResolver
        val folder = "${Environment.DIRECTORY_DOWNLOADS}/Kuriume"
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
            put(MediaStore.MediaColumns.MIME_TYPE, "application/json")
            put(MediaStore.MediaColumns.RELATIVE_PATH, folder)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val uri = resolver.insert(collection, values) ?: throw IllegalStateException("Downloads is unavailable")
        val savedName = try {
            resolver.openOutputStream(uri)?.use { output ->
                file.inputStream().use { input -> input.copyTo(output) }
            } ?: throw IllegalStateException("Downloads is read-only")
            values.clear()
            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            resolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) ?: file.name else file.name
            } ?: file.name
        } catch (error: Exception) {
            resolver.delete(uri, null, null)
            throw error
        }
        return "$folder/$savedName"
    }

    /** Android 9 and older have no MediaStore Downloads collection. */
    private fun saveToAppDownloads(file: File): String {
        val root = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
            ?: throw IllegalStateException("External storage is unavailable")
        val folder = File(root, "Kuriume")
        if (!folder.isDirectory && !folder.mkdirs()) {
            throw IllegalStateException("Cannot create the records folder")
        }
        val target = File(folder, file.name)
        file.copyTo(target, overwrite = true)
        return target.absolutePath
    }

    /** Opens the system share sheet for a records file the app just wrote. */
    @Command
    fun shareRecordFile(invoke: Invoke) {
        val args = invoke.parseArgs(RecordFileArgs::class.java)
        val file = File(args.path)
        if (file.parentFile?.canonicalPath != recordsFolder().canonicalPath || !file.isFile || !file.name.endsWith(".json")) {
            invoke.reject("Not a records file"); return
        }
        activity.runOnUiThread {
            try {
                val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.kuriume.records", file)
                val intent = Intent(Intent.ACTION_SEND)
                    .setType("application/json")
                    .putExtra(Intent.EXTRA_STREAM, uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                intent.clipData = android.content.ClipData.newRawUri("Kuriume records", uri)
                activity.startActivity(Intent.createChooser(intent, "Kuriume records"))
                invoke.resolve()
            } catch (error: Exception) {
                invoke.reject("Cannot share the file: ${error.message}")
            }
        }
    }

    private companion object {
        const val SECURE_ALIAS = "kuriume-webdav"
        const val MAX_RECORD_BYTES = 32L * 1024 * 1024
    }
}
