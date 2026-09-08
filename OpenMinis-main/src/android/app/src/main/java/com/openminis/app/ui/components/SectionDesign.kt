package com.openminis.app.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * Single source of truth for Settings section-card visual rhythm.
 * Mirror of iOS SwiftUI Form / List grouped style; the values below are
 * derived from the iOS reference screenshot and its pixel measurements.
 *
 * All Settings screens (ProviderDetail / MountedFolders / MountDetail /
 * ModelGroups / EnvironmentVariables / etc.) MUST consume from this
 * object rather than hard-coding values inline. When a value changes
 * here every screen updates atomically.
 */
object SectionDesign {
    /** Outer column padding from screen edge. iOS UIKit insets.left/.right = 16. */
    val ScreenHorizontalPadding = 16.dp

    /** Card corner radius. iOS UITableViewCell rounded section uses ~10pt. */
    val CardShape = RoundedCornerShape(12.dp)

    /** Distance from screen top → first section header. */
    val FirstSectionTopGap = 16.dp

    /** Distance from previous section's footer → next section header. */
    val SectionTopGap = 24.dp

    /** Distance from a section header → its card. */
    val HeaderToCardGap = 8.dp

    /** Distance from card → its footer caption. */
    val CardToFooterGap = 8.dp

    /** Distance between adjacent rows / cards inside the same section
     *  (e.g. mount list rows). iOS uses no gap with internal dividers
     *  but Android's surfaceContainer color contrast is weaker so keep
     *  a tight 8dp visual break. */
    val InterRowGap = 8.dp

    /** Standard row height inside a card. iOS row ≈ 44pt. */
    val RowMinHeight = 44.dp

    /** [T-android-settings-ui-md3] #3 Single-line text-field min height. MD3
     *  text fields are 56dp; the section rows were normalized to the same 56dp
     *  so an input field lines up with the toggle/value rows around it instead
     *  of reading as the old ~44/24dp mix. Kept separate from [RowMinHeight] so
     *  dropdowns / plain rows that intentionally sit tighter are unaffected. */
    val TextFieldMinHeight = 56.dp

    /** Horizontal padding inside the card (from card-inner-edge to row content). */
    val RowHorizontalPadding = 16.dp

    /** Vertical padding inside a row (top + bottom each). */
    val RowVerticalPadding = 10.dp

    /** Vertical padding wrapping the inner Column of a [SectionCard], so the
     *  first/last row don't hug the card's top/bottom edge. iOS Settings
     *  reserves a small gap here even though row dividers stay flush. */
    val CardInnerVerticalPadding = 6.dp

    /** Inner-card divider thickness. */
    val DividerThickness = 0.5.dp

    /** Inner-card divider left inset (so it tucks under content text rather
     *  than touching the card edge — matches iOS). */
    val DividerStartInset = 16.dp

    /** Card background — match iOS pure surface (white in light, near-black in dark).
     *  T313 follow-up: The app theme deliberately overrides Material3 semantics —
     *  `surface` is the page-level grouped background (gray / black) while
     *  `surfaceContainerLow` is the brighter card foreground. Using
     *  `surfaceContainerLow` here gives us the card color iOS Settings expects. */
    @Composable
    @ReadOnlyComposable
    fun cardColor(): Color = MaterialTheme.colorScheme.surfaceContainerLow

    /** Section background (the gray behind the cards) — match iOS systemGroupedBackground.
     *  Pairs with [cardColor]: this token is the dimmer page-level surface
     *  (`background` = light gray / near-black), so cards painted in
     *  `surfaceContainerLow` stand out against it. */
    @Composable
    @ReadOnlyComposable
    fun screenBackgroundColor(): Color = MaterialTheme.colorScheme.background

    /** Inner-card divider color — match iOS systemFill α 0.3. */
    @Composable
    @ReadOnlyComposable
    fun dividerColor(): Color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f)

    /** Footer caption color (gray text below cards). */
    @Composable
    @ReadOnlyComposable
    fun footerColor(): Color = MaterialTheme.colorScheme.onSurfaceVariant
}

/**
 * Section title above a card. iOS reference uses 17pt SemiBold sentence-case
 * onSurface — bigger and more present than Material's labelMedium ALL CAPS
 * onSurfaceVariant which fades into the background.
 */
@Composable
fun SectionHeader(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurface,
        modifier = modifier.padding(
            start = SectionDesign.ScreenHorizontalPadding,
            end = SectionDesign.ScreenHorizontalPadding,
            bottom = SectionDesign.HeaderToCardGap,
        ),
    )
}

/**
 * Footer caption below a card. iOS reference uses 13pt secondary onSurfaceVariant.
 */
@Composable
fun SectionFooter(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodySmall,
        color = SectionDesign.footerColor(),
        modifier = modifier.padding(
            start = SectionDesign.ScreenHorizontalPadding,
            end = SectionDesign.ScreenHorizontalPadding,
            top = SectionDesign.CardToFooterGap,
        ),
    )
}

/**
 * Container for one or more rows in a settings section. Replaces ad-hoc
 * Surface(surfaceContainerLow, RoundedCornerShape(12.dp)) call sites that
 * each pick their own color / shape / padding. Pass child rows; they get
 * the card background + corner clipping and divide themselves with
 * [SectionDivider] when stacked.
 */
@Composable
fun SectionCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        color = SectionDesign.cardColor(),
        shape = SectionDesign.CardShape,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = SectionDesign.ScreenHorizontalPadding),
    ) {
        Column(
            modifier = Modifier.padding(vertical = SectionDesign.CardInnerVerticalPadding),
            content = content,
        )
    }
}

/** Divider between rows inside a [SectionCard]. */
@Composable
fun SectionDivider() {
    HorizontalDivider(
        modifier = Modifier.padding(start = SectionDesign.DividerStartInset),
        thickness = SectionDesign.DividerThickness,
        color = SectionDesign.dividerColor(),
    )
}

/**
 * Inline label placed directly above a [SectionTextField] (or
 * [SectionDropdown]) when several labelled fields share a section but
 * each row needs its own short caption — too small a scope for a full
 * [SectionHeader]. Used by ModelEntryDetail / AddCustomModel /
 * AddProvider for fields like "Model ID" / "Display Name" / "Context Window".
 *
 * The previous `label =` slot on [SectionTextField] used Material3's
 * floating-label DecorationBox, but the row's tight `RowVerticalPadding`
 * (10dp) leaves no headroom — input glyphs overlap the floating label.
 * iOS Form puts every label outside its cell, so we follow the same
 * pattern: render the caption with this composable, then drop the
 * field below it.
 *
 * Horizontal padding is 0: callsites place this inside [SettingsCardBlock]
 * (or a manually padded Column) which already adds the 16dp inset. Adding
 * our own 16dp on top would double-indent the label relative to sibling
 * SectionHeader / description text / radio rows — see T353. Mirrors
 * SectionTextField's contentPadding=0 from T352.
 */
@Composable
fun RowLabel(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.padding(bottom = 6.dp),
    )
}
