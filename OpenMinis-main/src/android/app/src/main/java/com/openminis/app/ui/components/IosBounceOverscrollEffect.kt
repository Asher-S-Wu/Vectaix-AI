package com.openminis.app.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.OverscrollEffect
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.Velocity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.pow
import kotlin.math.sign

/**
 * iOS-style spring-bounce overscroll for vertical scroll containers.
 *
 * Default Android overscroll is either an edge glow (API <31) or a brief
 * stretch (API 31+); neither matches the rubber-band drag and bouncy
 * spring-back UIScrollView gives you on iOS. This effect:
 *
 *   - Translates the content by a *rubber-banded* fraction of the
 *     overscroll delta (longer drags compress harder, asymptoting), so the
 *     page visibly follows the finger past the top/bottom edge.
 *   - On release / fling, animates the offset back to 0 with
 *     [Spring.DampingRatioMediumBouncy] and [Spring.StiffnessLow] — the
 *     ratio iOS uses for bounce-back of overscrolled tables and scroll
 *     views (≈ 0.5 damping, slow restoring force, visible overshoot).
 *
 * Wire up with `Modifier.verticalScroll(state).overscroll(effect)`. The
 * `Modifier.overscroll` modifier registers a NestedScrollConnection so the
 * outer-edge component of every drag flows into [applyToScroll] and
 * post-fling momentum flows into [applyToFling], even though the inner
 * `verticalScroll` is the one that actually consumes scroll deltas. Use
 * [rememberIosBounceOverscrollEffect] to keep the same Animatable across
 * recompositions.
 */
@OptIn(ExperimentalFoundationApi::class)
class IosBounceOverscrollEffect(
    private val scope: CoroutineScope,
    /** Maximum visual stretch in pixels at "infinite" pull. iOS' UIScrollView
     *  caps around the viewport size; 600px feels right on Pixel-class
     *  densities without letting a stray fling rip the page off screen. */
    private val maxOverscrollPx: Float = 600f,
) : OverscrollEffect {

    private val offset = Animatable(0f)

    override val isInProgress: Boolean
        get() = offset.value != 0f

    override fun applyToScroll(
        delta: Offset,
        source: NestedScrollSource,
        performScroll: (Offset) -> Offset,
    ): Offset {
        // If we're already past an edge (offset != 0) and the user starts
        // pulling back toward 0, consume the matching component of the
        // gesture to unwind the rubber band before the inner scrollable
        // sees any of it. Mirrors UIScrollView's "release the bounce
        // before resuming scroll" behavior.
        val curOffset = offset.value
        val sameSign = curOffset != 0f && sign(delta.y) != sign(curOffset)
        val preConsumed = if (sameSign) {
            val correction = (-curOffset).coerceAtMost(abs(delta.y)) * sign(delta.y)
            scope.launch { offset.snapTo(curOffset + correction) }
            Offset(0f, correction)
        } else {
            Offset.Zero
        }

        val afterPre = delta - preConsumed
        val consumedByInner = performScroll(afterPre)
        val leftover = afterPre - consumedByInner

        if (leftover.y != 0f) {
            // User is dragging past an edge — apply the rubber band.
            val newOffset = curOffset + preConsumed.y + rubberBand(leftover.y, curOffset + preConsumed.y)
            scope.launch { offset.snapTo(newOffset) }
        }

        return preConsumed + consumedByInner
    }

    override suspend fun applyToFling(
        velocity: Velocity,
        performFling: suspend (Velocity) -> Velocity,
    ) {
        val leftover = performFling(velocity)
        // Spring back with iOS-bouncy parameters — mediumBouncy + stiffnessLow
        // gives ~0.5 damping with a slow restoring force, producing the
        // visible overshoot iOS users expect.
        offset.animateTo(
            targetValue = 0f,
            animationSpec = spring(
                dampingRatio = Spring.DampingRatioMediumBouncy,
                stiffness = Spring.StiffnessLow,
            ),
            initialVelocity = leftover.y,
        )
    }

    /** UIScrollView-style rubber band: overscroll = delta * (1 - |currentOffset|/max).
     *  Exponent 0.55 matches the curve UIKit's `_UIRubberBandClampedDistance` uses. */
    private fun rubberBand(delta: Float, currentOffset: Float): Float {
        val pull = abs(currentOffset).coerceAtMost(maxOverscrollPx)
        val resistance = (1f - (pull / maxOverscrollPx)).coerceAtLeast(0f).pow(0.55f)
        return delta * resistance
    }

    /** Translate the content by the current overscroll offset. Used by
     *  `Modifier.overscroll(effect)` to render the rubber band — we move the
     *  laid-out content vertically without resizing it, which preserves the
     *  inner scrollable's measured size. */
    override val effectModifier: Modifier = Modifier.layout { measurable, constraints ->
        val placeable = measurable.measure(constraints)
        layout(placeable.width, placeable.height) {
            placeable.placeRelative(0, offset.value.toInt())
        }
    }
}

/**
 * Composable factory that remembers an [IosBounceOverscrollEffect] tied to
 * the local [rememberCoroutineScope]. The returned instance is stable for
 * the composition's lifetime so callers can pass it to
 * `Modifier.overscroll(effect)`.
 */
@Composable
fun rememberIosBounceOverscrollEffect(): IosBounceOverscrollEffect {
    val scope = rememberCoroutineScope()
    return remember(scope) { IosBounceOverscrollEffect(scope) }
}
