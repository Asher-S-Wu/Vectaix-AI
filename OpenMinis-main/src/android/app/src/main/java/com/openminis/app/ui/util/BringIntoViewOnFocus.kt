package com.openminis.app.ui.util

import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.focus.onFocusEvent
import kotlinx.coroutines.launch

/**
 * Modifier that auto-scrolls the host's nearest scroll container to bring
 * this composable fully on-screen the moment it gains focus. Mirrors iOS
 * SwiftUI Form behavior — when the user taps a TextField near the bottom
 * of a long settings page, the IME pops up and the field would otherwise
 * be hidden under the keyboard. With this modifier it scrolls into view
 * just above the keyboard.
 *
 * Wrap any Compose `TextField` (or anything that can `.focusable()`) in
 * a column / LazyColumn that has `Modifier.imePadding()` set, then attach
 * `Modifier.bringIntoViewOnFocus()` to the field itself.
 *
 * Implementation notes:
 *   * `BringIntoViewRequester` is the canonical Compose primitive — the
 *     parent scroll container handles the actual scrolling, so this works
 *     transparently with `Column { verticalScroll(...) }` and
 *     `LazyColumn`.
 *   * We launch `bringIntoView()` on the composition's CoroutineScope so
 *     the call survives focus-change recompositions.
 *   * Listening to `onFocusEvent` (not `onFocusChanged`) so that the
 *     event also fires when focus arrives via tab/keyboard navigation,
 *     not just direct taps.
 */
@OptIn(ExperimentalComposeUiApi::class)
fun Modifier.bringIntoViewOnFocus(): Modifier = composed {
    val requester = remember { BringIntoViewRequester() }
    val scope = rememberCoroutineScope()
    this
        .bringIntoViewRequester(requester)
        .onFocusEvent { state ->
            if (state.isFocused) {
                scope.launch { requester.bringIntoView() }
            }
        }
}
