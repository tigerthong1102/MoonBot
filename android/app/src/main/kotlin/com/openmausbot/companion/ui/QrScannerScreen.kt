// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filterNotNull

// QR codes and deep links may prefill a destination but cannot silently authorize it.
@Composable
fun QrScannerScreen(onCancel: () -> Unit, validate: (String) -> String?) {
    val environment = LocalCompanion.current
    val access by environment.camera.access.collectAsState()
    var validationError by remember { mutableStateOf<String?>(null) }
    var cameraFailure by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { environment.camera.ensure() }

    Column(modifier = Modifier.fillMaxSize()) {
        Box(modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp)) {
            TextButton(onClick = onCancel, modifier = Modifier.align(Alignment.CenterStart)) {
                Text("Cancel")
            }
            Text(
                text = "Scan QR Code",
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.align(Alignment.Center),
            )
        }

        when {
            cameraFailure != null -> EmptyState(
                title = "Scanner unavailable",
                description = cameraFailure!!,
            )

            access == CameraAccess.UNKNOWN -> EmptyState(
                title = "Requesting camera access…",
                description = "Allow camera access to scan the pairing QR code shown by StartupBot.",
            )

            access == CameraAccess.DENIED -> EmptyState(
                title = "Camera access needed",
                description = "Allow camera access to scan the pairing QR code shown by " +
                    "StartupBot, or go back and enter the address and code by hand.",
            ) {
                Button(onClick = environment.openAppSettings) { Text("Open Settings") }
            }

            else -> ScannerSurface(
                validate = validate,
                validationError = validationError,
                onValidationError = { validationError = it },
                onCameraFailure = { cameraFailure = it },
            )
        }
    }
}

@Composable
private fun ScannerSurface(
    validate: (String) -> String?,
    validationError: String?,
    onValidationError: (String?) -> Unit,
    onCameraFailure: (String) -> Unit,
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val latched = remember { MutableStateFlow<String?>(null) }
    val analysisExecutor = remember { Executors.newSingleThreadExecutor() }
    val currentValidate by rememberUpdatedState(validate)
    val cameraLifecycle = remember { CameraLifecycle() }

    LaunchedEffect(latched) {
        latched.filterNotNull().collect { payload ->
            val problem = currentValidate(payload)
            if (problem == null) return@collect
            onValidationError(problem)
            delay(800)
            latched.value = null
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            cameraLifecycle.release()
            analysisExecutor.shutdown()
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { viewContext ->
                val previewView = PreviewView(viewContext)
                val providerFuture = ProcessCameraProvider.getInstance(viewContext)
                providerFuture.addListener(
                    {
                        try {
                            val provider = providerFuture.get()
                            val started = cameraLifecycle.startAnalyzing(
                                createAnalyzer = {
                                    QrCodeAnalyzer { payload ->
                                        latched.compareAndSet(null, payload)
                                    }
                                },
                                releaseAnalyzer = { analyzer ->
                                    runCatching { provider.unbindAll() }
                                    analyzer.close()
                                },
                                bind = { analyzer ->
                                    bindCamera(
                                        provider = provider,
                                        lifecycleOwner = lifecycleOwner,
                                        previewView = previewView,
                                        executor = analysisExecutor,
                                        analyzer = analyzer,
                                    )
                                },
                                onFailure = { error ->
                                    Log.w("PairingScanner", "could not bind the camera", error)
                                },
                            )
                            if (!started) onCameraFailure(CAMERA_UNAVAILABLE)
                        } catch (error: Exception) {
                            Log.w("PairingScanner", "camera unavailable", error)
                            onCameraFailure(CAMERA_UNAVAILABLE)
                        }
                    },
                    ContextCompat.getMainExecutor(viewContext),
                )
                previewView
            },
        )

        Text(
            text = validationError ?: "Point the camera at the QR code on your computer",
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
            color = if (validationError == null) {
                MaterialTheme.colorScheme.onSurface
            } else {
                MaterialTheme.colorScheme.error
            },
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(16.dp)
                .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(18.dp))
                .padding(horizontal = 18.dp, vertical = 14.dp),
        )
    }
}

internal class CameraLifecycle {
    private var pendingRelease: (() -> Unit)? = null
    private var released = false

    fun bound(release: () -> Unit) {
        if (released) {
            release()
            return
        }
        pendingRelease?.invoke()
        pendingRelease = release
    }

    fun release() {
        released = true
        val pending = pendingRelease
        pendingRelease = null
        pending?.invoke()
    }
}

internal fun <A> CameraLifecycle.startAnalyzing(
    createAnalyzer: () -> A,
    releaseAnalyzer: (A) -> Unit,
    bind: (A) -> Unit,
    onFailure: (Exception) -> Unit = {},
): Boolean {
    val analyzer = createAnalyzer()
    bound { releaseAnalyzer(analyzer) }
    return try {
        bind(analyzer)
        true
    } catch (error: Exception) {
        release()
        onFailure(error)
        false
    }
}

private const val CAMERA_UNAVAILABLE =
    "This phone's camera could not be started. Use its Camera app to read the QR code, " +
        "or enter the address and code by hand."


private fun bindCamera(
    provider: ProcessCameraProvider,
    lifecycleOwner: LifecycleOwner,
    previewView: PreviewView,
    executor: java.util.concurrent.Executor,
    analyzer: ImageAnalysis.Analyzer,
) {
    val preview = Preview.Builder().build().apply {
        surfaceProvider = previewView.surfaceProvider
    }
    val analysis = ImageAnalysis.Builder()
        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        .build()
    analysis.setAnalyzer(executor, analyzer)
    provider.unbindAll()
    provider.bindToLifecycle(
        lifecycleOwner,
        CameraSelector.DEFAULT_BACK_CAMERA,
        preview,
        analysis,
    )
}

private class QrCodeAnalyzer(private val onPayload: (String) -> Unit) : ImageAnalysis.Analyzer {
    private val scanner = BarcodeScanning.getClient(
        BarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .build(),
    )

    fun close() {
        runCatching { scanner.close() }
    }

    @androidx.annotation.OptIn(ExperimentalGetImage::class)
    override fun analyze(image: ImageProxy) {
        val frame = image.image
        if (frame == null) {
            image.close()
            return
        }
        scanner.process(InputImage.fromMediaImage(frame, image.imageInfo.rotationDegrees))
            .addOnSuccessListener { codes ->
                codes.firstNotNullOfOrNull { it.rawValue }?.let(onPayload)
            }
            .addOnCompleteListener { image.close() }
    }
}
