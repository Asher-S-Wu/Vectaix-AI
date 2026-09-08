package com.openminis.app.ui.media

import android.content.Intent
import android.media.MediaPlayer
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import java.io.File
import kotlin.math.roundToInt

/**
 * Inline audio player composable for embedding in chat messages.
 * Shows play/pause/stop controls and a progress bar.
 */
@Composable
fun InlineAudioPlayer(
    filePath: String,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var isPlaying by remember { mutableStateOf(false) }
    var progress by remember { mutableFloatStateOf(0f) }
    var duration by remember { mutableStateOf("0:00") }
    var position by remember { mutableStateOf("0:00") }
    var error by remember { mutableStateOf<String?>(null) }

    val mediaPlayer = remember { MediaPlayer() }

    DisposableEffect(filePath) {
        try {
            val file = File(filePath)
            if (file.exists()) {
                mediaPlayer.setDataSource(file.absolutePath)
            } else {
                // Try as content URI
                mediaPlayer.setDataSource(context, Uri.parse(filePath))
            }
            mediaPlayer.prepare()
            duration = formatDuration(mediaPlayer.duration)

            mediaPlayer.setOnCompletionListener {
                isPlaying = false
                progress = 0f
                position = "0:00"
            }
        } catch (e: Exception) {
            error = e.message
        }

        onDispose {
            try {
                if (mediaPlayer.isPlaying) mediaPlayer.stop()
                mediaPlayer.release()
            } catch (_: Exception) {}
        }
    }

    // Progress ticker
    LaunchedEffect(isPlaying) {
        while (isPlaying && isActive) {
            try {
                val pos = mediaPlayer.currentPosition
                val dur = mediaPlayer.duration.coerceAtLeast(1)
                progress = pos.toFloat() / dur
                position = formatDuration(pos)
            } catch (_: Exception) {}
            delay(250)
        }
    }

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp)),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
    ) {
        if (error != null) {
            Text(
                "Audio error: $error",
                modifier = Modifier.padding(12.dp),
                color = MaterialTheme.colorScheme.error,
                fontSize = 12.sp,
            )
        } else {
            Column(
                modifier = Modifier.padding(12.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // Play/Pause button
                    IconButton(
                        onClick = {
                            if (isPlaying) {
                                mediaPlayer.pause()
                                isPlaying = false
                            } else {
                                mediaPlayer.start()
                                isPlaying = true
                            }
                        },
                        modifier = Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.primary),
                    ) {
                        Icon(
                            if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = if (isPlaying) "Pause" else "Play",
                            tint = MaterialTheme.colorScheme.onPrimary,
                            modifier = Modifier.size(20.dp),
                        )
                    }

                    Spacer(Modifier.width(12.dp))

                    Column(modifier = Modifier.weight(1f)) {
                        LinearProgressIndicator(
                            progress = { progress },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(4.dp)
                                .clip(RoundedCornerShape(2.dp)),
                        )
                        Spacer(Modifier.height(4.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(position, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(duration, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }

                    // Stop button
                    if (isPlaying) {
                        Spacer(Modifier.width(8.dp))
                        IconButton(
                            onClick = {
                                mediaPlayer.seekTo(0)
                                mediaPlayer.pause()
                                isPlaying = false
                                progress = 0f
                                position = "0:00"
                            },
                            modifier = Modifier.size(28.dp),
                        ) {
                            Icon(
                                Icons.Default.Stop,
                                contentDescription = "Stop",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                }

                // File name
                val fileName = filePath.substringAfterLast("/")
                Text(
                    fileName,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
    }
}

/**
 * Inline video player composable. On Android without ExoPlayer,
 * this uses a VideoView via AndroidView.
 */
@Composable
fun InlineVideoPlayer(
    filePath: String,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp)),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
    ) {
        androidx.compose.ui.viewinterop.AndroidView(
            factory = { ctx ->
                android.widget.VideoView(ctx).apply {
                    val file = File(filePath)
                    val uri = if (file.exists()) Uri.fromFile(file) else Uri.parse(filePath)
                    setVideoURI(uri)

                    // Add basic media controller
                    val controller = android.widget.MediaController(ctx)
                    controller.setAnchorView(this)
                    setMediaController(controller)

                    setOnPreparedListener { mp ->
                        // Auto-size to video dimensions
                        val videoWidth = mp.videoWidth
                        val videoHeight = mp.videoHeight
                        if (videoWidth > 0 && videoHeight > 0) {
                            val ratio = videoHeight.toFloat() / videoWidth
                            layoutParams = layoutParams.apply {
                                height = (width * ratio).toInt().coerceIn(100, 800)
                            }
                        }
                        // Auto-play and surface the controller so the user sees
                        // a live first frame instead of a black surface waiting
                        // for an extra tap.
                        start()
                        controller.show(0)
                    }
                    setOnErrorListener { _, what, extra ->
                        android.util.Log.w("InlineVideoPlayer",
                            "VideoView error what=$what extra=$extra path=$filePath")
                        false
                    }
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .height(240.dp),
        )
    }
}

private fun formatDuration(ms: Int): String {
    val totalSec = ms / 1000
    val min = totalSec / 60
    val sec = totalSec % 60
    return "%d:%02d".format(min, sec)
}

/**
 * Fullscreen video player dialog. Matches iOS `MinisVideoFullscreenPlayer`:
 * - Black background, video centered via VideoView
 * - Top bar: close (X) + share action
 * - Bottom bar: play/pause + current time + slider + duration
 * - Tap the video to toggle controls (auto-hide after 3s)
 * - Drag down to dismiss with rubber-band feedback
 *
 * Uses AndroidView(VideoView) to avoid ExoPlayer dependency.
 */
@Composable
fun MinisFullscreenVideoPlayer(
    file: File,
    onDismiss: () -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
        ),
    ) {
        FullscreenVideoContent(file = file, onDismiss = onDismiss)
    }
}

@Composable
private fun FullscreenVideoContent(file: File, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val density = LocalDensity.current
    val view = LocalView.current

    // Immersive system bars for the lifetime of this player. Mirrors iOS's
    // fullScreenCover which hides the status bar. Restores the bars on dispose
    // so the chat view comes back with its normal chrome.
    DisposableEffect(view) {
        val window = findDialogWindow(view)
        var originalLightStatusBars: Boolean? = null
        var originalLightNavigationBars: Boolean? = null
        if (window != null) {
            // Draw behind the system bars so our black background reaches the
            // top/bottom edges; the controller then hides them.
            androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, false)
            // Size the Dialog window to the full display so nothing from the
            // underlying Activity (top bar, message list) peeks through at the
            // top edge. Without MATCH_PARENT + layoutInDisplayCutoutMode the
            // Dialog respects system-bar insets and leaves a gap.
            try {
                val attrs = window.attributes
                attrs.width = android.view.WindowManager.LayoutParams.MATCH_PARENT
                attrs.height = android.view.WindowManager.LayoutParams.MATCH_PARENT
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                    attrs.layoutInDisplayCutoutMode =
                        android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                }
                window.attributes = attrs
                window.setLayout(
                    android.view.WindowManager.LayoutParams.MATCH_PARENT,
                    android.view.WindowManager.LayoutParams.MATCH_PARENT,
                )
                window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(android.graphics.Color.BLACK))
                window.statusBarColor = android.graphics.Color.TRANSPARENT
                window.navigationBarColor = android.graphics.Color.TRANSPARENT
            } catch (_: Throwable) {}
            val controller = androidx.core.view.WindowInsetsControllerCompat(window, window.decorView)
            originalLightStatusBars = controller.isAppearanceLightStatusBars
            originalLightNavigationBars = controller.isAppearanceLightNavigationBars
            // Dark-background immersive: white icons if they ever peek in.
            controller.isAppearanceLightStatusBars = false
            controller.isAppearanceLightNavigationBars = false
            controller.systemBarsBehavior =
                androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars())
        }
        onDispose {
            if (window != null) {
                val controller = androidx.core.view.WindowInsetsControllerCompat(window, window.decorView)
                controller.show(androidx.core.view.WindowInsetsCompat.Type.systemBars())
                originalLightStatusBars?.let { controller.isAppearanceLightStatusBars = it }
                originalLightNavigationBars?.let { controller.isAppearanceLightNavigationBars = it }
            }
        }
    }

    var videoView by remember { mutableStateOf<android.widget.VideoView?>(null) }
    var isPlaying by remember { mutableStateOf(true) }
    var durationMs by remember { mutableStateOf(0) }
    var positionMs by remember { mutableStateOf(0) }
    var scrubbing by remember { mutableStateOf(false) }
    var scrubTarget by remember { mutableFloatStateOf(0f) }
    var showControls by remember { mutableStateOf(true) }
    var dragOffsetPx by remember { mutableFloatStateOf(0f) }

    val dismissThresholdPx = with(density) { 120.dp.toPx() }

    // Poll position while playing to drive the slider.
    LaunchedEffect(videoView, isPlaying, scrubbing) {
        while (isActive && videoView != null) {
            if (isPlaying && !scrubbing) {
                try {
                    val v = videoView!!
                    positionMs = v.currentPosition
                    if (durationMs <= 0) durationMs = v.duration.coerceAtLeast(0)
                } catch (_: Throwable) {}
            }
            delay(200)
        }
    }

    // Auto-hide controls after 3s while playing.
    LaunchedEffect(showControls, isPlaying, scrubbing) {
        if (showControls && isPlaying && !scrubbing) {
            delay(3000)
            showControls = false
        }
    }

    val backdropAlpha = (1f - (dragOffsetPx.coerceAtLeast(0f) / dismissThresholdPx) * 0.4f)
        .coerceIn(0.4f, 1f)

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = backdropAlpha))
            .pointerInput(Unit) {
                detectVerticalDragGestures(
                    onVerticalDrag = { _, dy ->
                        dragOffsetPx = if (dragOffsetPx + dy > 0f) dragOffsetPx + dy
                        else (dragOffsetPx + dy * 0.3f)
                    },
                    onDragEnd = {
                        if (dragOffsetPx > dismissThresholdPx * 0.5f) {
                            try { videoView?.pause() } catch (_: Throwable) {}
                            onDismiss()
                        } else {
                            dragOffsetPx = 0f
                        }
                    },
                    onDragCancel = { dragOffsetPx = 0f },
                )
            },
    ) {
        // Video surface — offset with drag, toggle controls on tap.
        androidx.compose.ui.viewinterop.AndroidView(
            factory = { ctx ->
                android.widget.VideoView(ctx).apply {
                    setVideoURI(Uri.fromFile(file))
                    setOnPreparedListener { mp ->
                        durationMs = mp.duration.coerceAtLeast(0)
                        mp.isLooping = false
                        start()
                        isPlaying = true
                    }
                    setOnCompletionListener {
                        isPlaying = false
                        positionMs = durationMs
                        showControls = true
                    }
                    setOnErrorListener { _, _, _ ->
                        android.util.Log.w("FullscreenVideo", "VideoView error for ${file.absolutePath}")
                        true
                    }
                    videoView = this
                }
            },
            modifier = Modifier
                .fillMaxSize()
                .offset { IntOffset(0, dragOffsetPx.roundToInt()) }
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                ) { showControls = !showControls },
        )

        // Top bar: close (always visible when controls shown).
        AnimatedVisibility(
            visible = showControls,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.TopStart),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    // Bars are hidden, but the status bar can reappear via
                    // transient-swipe and the display cutout still occupies
                    // the top edge — offset past both so the close/share
                    // buttons never sit under the notch or status chrome.
                    .windowInsetsPadding(
                        WindowInsets.statusBars.union(WindowInsets.displayCutout),
                    )
                    .padding(horizontal = 12.dp)
                    .padding(top = 12.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircleControlButton(
                    icon = Icons.Default.Close,
                    contentDescription = "Close",
                    onClick = {
                        try { videoView?.pause() } catch (_: Throwable) {}
                        onDismiss()
                    },
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = file.name,
                    color = Color.White.copy(alpha = 0.9f),
                    fontSize = 13.sp,
                    maxLines = 1,
                    modifier = Modifier.weight(1f),
                )
                CircleControlButton(
                    icon = Icons.Default.Share,
                    contentDescription = "Share",
                    onClick = { shareMediaFile(context, file, "video/*") },
                )
            }
        }

        // Bottom controls: play/pause, current time, slider, duration.
        AnimatedVisibility(
            visible = showControls,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.BottomStart),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color.Black.copy(alpha = 0.45f))
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(
                    onClick = {
                        val v = videoView ?: return@IconButton
                        try {
                            if (isPlaying) { v.pause(); isPlaying = false }
                            else {
                                // If at end, restart from 0.
                                if (durationMs in 1..(positionMs + 500)) {
                                    v.seekTo(0)
                                    positionMs = 0
                                }
                                v.start()
                                isPlaying = true
                            }
                        } catch (_: Throwable) {}
                    },
                    modifier = Modifier.size(40.dp),
                ) {
                    Icon(
                        imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = if (isPlaying) "Pause" else "Play",
                        tint = Color.White,
                    )
                }
                Text(
                    text = formatDuration(if (scrubbing) scrubTarget.roundToInt() else positionMs),
                    color = Color.White.copy(alpha = 0.85f),
                    fontSize = 11.sp,
                    modifier = Modifier.padding(end = 8.dp),
                )
                Slider(
                    value = if (scrubbing) scrubTarget else positionMs.toFloat(),
                    onValueChange = { v ->
                        scrubbing = true
                        scrubTarget = v
                    },
                    onValueChangeFinished = {
                        val v = videoView
                        val target = scrubTarget.roundToInt()
                        if (v != null) {
                            try { v.seekTo(target) } catch (_: Throwable) {}
                            positionMs = target
                        }
                        scrubbing = false
                    },
                    valueRange = 0f..(durationMs.coerceAtLeast(1)).toFloat(),
                    colors = SliderDefaults.colors(
                        thumbColor = Color.White,
                        activeTrackColor = Color.White,
                        inactiveTrackColor = Color.White.copy(alpha = 0.3f),
                    ),
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = formatDuration(durationMs),
                    color = Color.White.copy(alpha = 0.85f),
                    fontSize = 11.sp,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun CircleControlButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .size(40.dp)
            .clip(CircleShape)
            .background(Color.Black.copy(alpha = 0.5f))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = contentDescription,
            tint = Color.White,
            modifier = Modifier.size(20.dp),
        )
    }
}

/**
 * Share a resolved media file via the system chooser (Save / Share / open in
 * another player). Uses FileProvider so the external handler gets a readable
 * content:// URI.
 */
/**
 * Walk the Compose view's parent chain to find the hosting `Window`. When
 * Compose renders inside a `Dialog`, the ComposeView is attached to an
 * internal `DialogWindowProvider` whose `window` is the Dialog's Window
 * (distinct from the host Activity's Window). Returns null if the search
 * terminates before hitting a provider — callers should no-op in that case.
 */
private fun findDialogWindow(view: android.view.View): android.view.Window? {
    var parent: Any? = view.parent
    while (parent != null) {
        if (parent is androidx.compose.ui.window.DialogWindowProvider) {
            return parent.window
        }
        parent = (parent as? android.view.View)?.parent
    }
    return null
}

private fun shareMediaFile(context: android.content.Context, file: File, mime: String) {
    val authority = context.packageName + ".fileprovider"
    val uri = try {
        androidx.core.content.FileProvider.getUriForFile(context, authority, file)
    } catch (_: Throwable) {
        Uri.fromFile(file)
    }
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = mime
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    val chooser = Intent.createChooser(intent, file.name).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    try { context.startActivity(chooser) } catch (_: Throwable) {}
}
