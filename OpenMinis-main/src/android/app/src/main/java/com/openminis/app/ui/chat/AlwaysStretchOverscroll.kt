package com.openminis.app.ui.chat

import androidx.compose.foundation.OverscrollEffect
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.rememberScrollableState
import androidx.compose.foundation.gestures.scrollable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.overscroll
import androidx.compose.foundation.rememberOverscrollEffect
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * LazyColumn stops running its drag handler once canScrollForward/Backward
 * are both false, so the platform stretch overscroll never fires when the
 * list content fits the viewport. Wrap the list in this box to restore it:
 * the outer scrollable always accepts gestures, consumes 0, and pipes the
 * delta into a shared stretch effect. The inner LazyColumn, given the same
 * effect, forwards its own overflow too.
 *
 * Usage:
 *   AlwaysStretchOverscrollBox { effect ->
 *     LazyColumn(overscrollEffect = effect, ...) { ... }
 *   }
 */
@Composable
fun AlwaysStretchOverscrollBox(
    modifier: Modifier = Modifier,
    content: @Composable (OverscrollEffect?) -> Unit,
) {
    val effect = rememberOverscrollEffect()
    val noopState = rememberScrollableState { 0f }
    val boxModifier = if (effect != null) {
        modifier
            .fillMaxSize()
            .scrollable(
                state = noopState,
                orientation = Orientation.Vertical,
                overscrollEffect = effect,
            )
            .overscroll(effect)
    } else {
        modifier.fillMaxSize()
    }
    Box(modifier = boxModifier) {
        content(effect)
    }
}
