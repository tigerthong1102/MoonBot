package com.openmausbot.companion.ui

import android.content.Context
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebMessage
import android.webkit.WebMessagePort
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.viewinterop.AndroidView
import com.openmausbot.companion.R
import com.openmausbot.companion.dictation.SpeechDictation
import java.io.File
import java.net.URI
import java.util.Locale
import java.util.UUID
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

internal fun personalInboxOrigin(setting: String): Uri? {
    val uri = Uri.parse(setting)
    return uri.takeIf {
        it.scheme == "https" && !it.host.isNullOrBlank() && it.userInfo == null &&
            it.query == null && it.fragment == null && (it.path == "" || it.path == "/" || it.path == null)
    }
}

private fun Uri.matchesInbox(candidate: Uri): Boolean =
    candidate.scheme == scheme && candidate.host == host && candidate.userInfo == null &&
        (if (candidate.port == -1) 443 else candidate.port) == (if (port == -1) 443 else port)

private data class InboxDownload(val url: String, val name: String)

private fun saveInboxDownload(context: Context, origin: Uri, download: InboxDownload, destination: Uri): Boolean {
    val url = Uri.parse(download.url)
    if (!origin.matchesInbox(url) ||
        !Regex("/api/(rooms/[0-9a-f-]{36}/files/[0-9]+|saved/[0-9]+/download)").matches(url.path.orEmpty())) return false
    val cookie = CookieManager.getInstance().getCookie(download.url) ?: return false
    return runCatching {
        val connection = URI(download.url).toURL().openConnection() as HttpsURLConnection
        val temporary = File.createTempFile("inbox-", ".download", context.cacheDir)
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.setRequestProperty("Cookie", cookie)
            connection.setRequestProperty("Accept-Encoding", "identity")
            if (connection.responseCode != 200 || connection.contentLengthLong > 50_000_000L) return false
            connection.inputStream.use { input ->
                temporary.outputStream().use { file ->
                    val buffer = ByteArray(64 * 1024)
                    var written = 0L
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        written += count
                        if (written > 50_000_000L) return false
                        file.write(buffer, 0, count)
                    }
                    if (written == 0L || (connection.contentLengthLong >= 0 && written != connection.contentLengthLong)) return false
                }
            }
            val output = context.contentResolver.openOutputStream(destination, "wt") ?: return false
            output.use { file -> temporary.inputStream().use { it.copyTo(file) } }
            true
        } finally {
            connection.disconnect()
            temporary.delete()
        }
    }.getOrDefault(false)
}

@Composable
internal fun PersonalInboxScreen(origin: Uri, onBack: () -> Unit) {
    val environment = LocalCompanion.current
    val context = LocalContext.current
    val language = LocalConfiguration.current.locales[0]?.toLanguageTag() ?: Locale.getDefault().toLanguageTag()
    val controller = remember(origin) {
        InboxWebView(origin, environment.dictation) { callback -> environment.mic.ensure(callback) }
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        controller.receiveFiles(uris.takeIf { it.isNotEmpty() }?.toTypedArray())
    }
    val scope = rememberCoroutineScope()
    var pendingDownload by remember(origin) { mutableStateOf<InboxDownload?>(null) }
    val downloadPicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val download = pendingDownload
        pendingDownload = null
        if (download != null && uri != null) scope.launch {
            val saved = withContext(Dispatchers.IO) { saveInboxDownload(context, origin, download, uri) }
            if (!saved) Toast.makeText(context, R.string.ui_try_again, Toast.LENGTH_SHORT).show()
        }
    }
    LaunchedEffect(controller) {
        val engine = environment.dictation
        combine(engine.transcript, engine.isStarting, engine.isListening, engine.error) { _, _, _, _ -> Unit }
            .collect { controller.recognized() }
    }
    DisposableEffect(controller) { onDispose { controller.close() } }
    BackHandler(onBack = onBack)

    Column(Modifier.fillMaxSize().imePadding()) {
        Row {
            HeaderBackButton(onBack)
            Text(stringResource(R.string.ui_messages))
        }
        HorizontalDivider()
        AndroidView(
            modifier = Modifier.weight(1f),
            factory = {
                controller.open(context, language, { picker.launch(arrayOf("*/*")) }) { download ->
                    if (pendingDownload == null) {
                        pendingDownload = download
                        downloadPicker.launch(download.name)
                    }
                }
            },
        )
    }
}

private class InboxWebView(
    private val origin: Uri,
    private val dictation: SpeechDictation,
    private val askMicrophone: ((Boolean) -> Unit) -> Unit,
) {
    private var page: WebView? = null
    private var channel: WebMessagePort? = null
    private var permission: PermissionRequest? = null
    private var picker: ValueCallback<Array<Uri>>? = null
    private var token: String? = null
    private var started = false
    private var lastText = ""

    private fun trusted(url: String?): Boolean = url != null && origin.matchesInbox(Uri.parse(url))

    fun open(context: Context, language: String, choose: () -> Unit, download: (InboxDownload) -> Unit): WebView = WebView(context).apply {
        page = this
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowContentAccess = false
        settings.allowFileAccess = false
        settings.mediaPlaybackRequiresUserGesture = true
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                !request.isForMainFrame || !origin.matchesInbox(request.url)

            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                reset()
            }

            override fun onPageFinished(view: WebView, url: String?) {
                if (!trusted(url) || !trusted(view.url)) return
                channel?.close()
                val ports = view.createWebMessageChannel()
                channel = ports[0]
                ports[0].setWebMessageCallback(object : WebMessagePort.WebMessageCallback() {
                    override fun onMessage(port: WebMessagePort, message: WebMessage) {
                        if (port == channel && trusted(view.url) && view.isShown) command(message.data)
                    }
                })
                view.postWebMessage(WebMessage("startupbot-mobile-voice", arrayOf(ports[1])), origin)
            }
        }
        webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                if (!trusted(page?.url) || !origin.matchesInbox(request.origin) ||
                    !request.resources.contentEquals(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))) {
                    request.deny()
                    return
                }
                permission?.deny()
                permission = request
                askMicrophone { granted ->
                    if (permission != request) return@askMicrophone
                    permission = null
                    if (granted && trusted(page?.url) && page?.isShown == true) request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                    else request.deny()
                }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (permission == request) permission = null
            }

            override fun onShowFileChooser(webView: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                if (!trusted(webView.url)) return false
                receiveFiles(null)
                picker = callback
                choose()
                return true
            }
        }
        setDownloadListener { url, _, disposition, mime, _ ->
            if (!trusted(url)) return@setDownloadListener
            download(InboxDownload(url, URLUtil.guessFileName(url, disposition, mime)))
        }
        loadUrl(origin.buildUpon().path("/").appendQueryParameter("mobile", "android").appendQueryParameter("lang", language).build().toString())
    }

    private fun command(raw: String?) {
        val message = raw?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return
        val id = message.optString("id")
        if (id.length != 36 || runCatching { UUID.fromString(id) }.isFailure) return
        when (message.optString("action")) {
            "start" -> if (token == null && !dictation.isStarting.value && !dictation.isListening.value) {
                token = id
                started = false
                lastText = ""
                dictation.toggle(capturing = "")
            } else if (token != id) send(id, "status", "unavailable")
            "finish" -> if (token == id) {
                token = null
                dictation.stop()
                send(id, "status", "done")
            }
            "cancel" -> if (token == id) stopDictation()
        }
    }

    fun recognized() {
        val id = token ?: return
        val active = dictation.isStarting.value || dictation.isListening.value
        val text = dictation.transcript.value
        val failed = dictation.error.value != null
        if (active) started = true
        if (started && text.isNotEmpty() && text != lastText) {
            lastText = text
            send(id, "text", text)
        }
        if (!active && (started || failed)) {
            token = null
            send(id, "status", if (failed) "failed" else "done")
        }
    }

    private fun send(id: String, key: String, value: String) {
        channel?.postMessage(WebMessage(JSONObject().put("id", id).put(key, value).toString()))
    }

    fun receiveFiles(uris: Array<Uri>?) {
        picker?.onReceiveValue(uris)
        picker = null
    }

    private fun stopDictation() {
        if (token == null) return
        token = null
        dictation.stop()
    }

    private fun reset() {
        stopDictation()
        permission?.deny()
        permission = null
        channel?.close()
        channel = null
        receiveFiles(null)
    }

    fun close() {
        reset()
        page?.stopLoading()
        page?.destroy()
        page = null
    }
}
