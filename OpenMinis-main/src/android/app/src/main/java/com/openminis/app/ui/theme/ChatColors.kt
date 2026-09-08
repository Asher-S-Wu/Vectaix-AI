package com.openminis.app.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color

// Semantic chat colors mirroring iOS ChatColors (AIChatView.swift).
// Resolved from LocalChatPalette, which is provided by MinisTheme.
//
// iOS reference:
//   systemBackground        -> background
//   secondarySystemBackground -> secondaryBg
//   tertiarySystemFill      -> userBubble
//   tertiarySystemGroupedBackground -> toolBg
//   label                   -> primaryText
//   secondaryLabel          -> secondaryText
//   tertiaryLabel           -> tertiaryText
//   quaternaryLabel         -> sendButtonDisabled
//   separator               -> border
//   systemGray6             -> inlineCodeBg / toolCapsuleBg
@Immutable
data class ChatPalette(
    val isDark: Boolean,
    val background: Color,
    val secondaryBg: Color,
    val inputBg: Color,
    val inputIconBg: Color,
    val inputIconBorder: Color,
    val inputBorder: Color,
    val primaryText: Color,
    val secondaryText: Color,
    val tertiaryText: Color,
    val disabledText: Color,
    val userBubble: Color,
    val toolBg: Color,
    val toolBorder: Color,
    val toolCapsuleBg: Color,
    val separator: Color,
    val sendButton: Color,
    val sendButtonDisabled: Color,
    val codeBlockBg: Color,
    val codeBlockText: Color,
    val inlineCodeBg: Color,
    val inlineCodeText: Color,
    val link: Color,
    val blockquoteBar: Color,
    val thinking: Color,
    val warningBg: Color,
    val warningText: Color,
    val tableBorder: Color,
    val inputShadow: Color,
    val toastBg: Color,
    val thumbnailBorder: Color,
    val sheetHeaderBg: Color,
    val sheetHeaderBorder: Color,
    val fabAccent: Color,
)

val LightChatPalette = ChatPalette(
    isDark = false,
    background = Color.White,
    secondaryBg = Color(0xFFF2F2F7),
    inputBg = Color.White,
    inputIconBg = Color(0xFFF2F2F7),
    inputIconBorder = Color.Transparent,
    inputBorder = Color(0x4D3C3C43),
    primaryText = Color(0xFF000000),
    secondaryText = Color(0x993C3C43),
    tertiaryText = Color(0x4D3C3C43),
    disabledText = Color(0x2E3C3C43),
    userBubble = Color(0x1E787880),
    toolBg = Color(0xFFF2F2F7),
    toolBorder = Color(0x14000000),
    toolCapsuleBg = Color(0xFFF2F2F7),
    separator = Color(0x4D3C3C43),
    sendButton = Color(0xFF000000),
    sendButtonDisabled = Color(0x2E3C3C43),
    codeBlockBg = Color(0xFF000000),
    codeBlockText = Color(0xFF34C759),
    inlineCodeBg = Color(0xFFF2F2F7),
    inlineCodeText = Color(0xFFFF9500),
    link = Color(0xFF007AFF),
    blockquoteBar = Color(0x80FF9500),
    thinking = Color(0xFF007AFF),
    warningBg = Color(0x14FF9500),
    warningText = Color(0x73000000),
    tableBorder = Color(0x1F000000),
    inputShadow = Color.Transparent,
    toastBg = Color(0x2E007AFF),
    thumbnailBorder = Color(0x33808080),
    sheetHeaderBg = Color(0xFFFFFFFF),
    sheetHeaderBorder = Color(0x1A000000),
    fabAccent = Color(0xFFB7AF96),
)

// T153: Android-specific dark palette tweaks. iOS borrows the system
// palette (#1C1C1E / #2C2C2E etc.) which reads as "layered dark grey"
// on a 1000+ nit display, but on a typical Android phone (Pixel 6 ≈
// 500 nits, mid-range OEMs even less) those layers crush together
// into a single near-black wash and the user can't tell tool capsules
// from background or input from message list. Lift the non-background
// layers ~6-10% so the contrast survives the brightness gap; the pure
// `background` itself stays #000 because every other color is keyed
// to "darker than this".
val DarkChatPalette = ChatPalette(
    isDark = true,
    background = Color(0xFF000000),
    secondaryBg = Color(0xFF26262A),
    inputBg = Color(0xFF2C2C30),
    inputIconBg = Color(0xFF1C1C1E),
    inputIconBorder = Color(0xFF595959),
    inputBorder = Color(0x40545458),
    primaryText = Color(0xFFFFFFFF),
    secondaryText = Color(0x99EBEBF5),
    tertiaryText = Color(0x4DEBEBF5),
    disabledText = Color(0x2EEBEBF5),
    // [T-android-user-bubble-dark-contrast] The old 0x247676D7 was a 14%-alpha
    // translucent blue-grey that washed out to near-invisible on the #000 chat
    // background on real (≈500-nit) displays — exactly the "crush to a near-black
    // wash" failure the palette header warns about. Use an OPAQUE cool slate-blue
    // so the user's own messages read as a distinct accent; white primaryText
    // stays legible on it.
    userBubble = Color(0xFF2F3A5C),
    toolBg = Color(0xFF3A3A3F),
    toolBorder = Color(0x40545458),
    toolCapsuleBg = Color(0xFF28282C),
    separator = Color(0x99545458),
    sendButton = Color(0xFFFFFFFF),
    sendButtonDisabled = Color(0x2EEBEBF5),
    codeBlockBg = Color(0xFF262626),
    codeBlockText = Color(0xFF8CF38C),
    // [T-inline-code-dark-bg-android] Lifted into the T153 ramp — the old
    // #1C1C1E chip was invisible on the #000 chat background (the comment
    // block above explains why non-background layers need the ~6-10% lift;
    // this one was missed). #34343A sits between inputBg (#2C2C30) and
    // toolBg (#3A3A3F), clearly above codeBlockBg (#262626) so small inline
    // chips read against both the wash and fenced blocks.
    inlineCodeBg = Color(0xFF34343A),
    inlineCodeText = Color(0xFFFF9F0A),
    link = Color(0xFF0A84FF),
    blockquoteBar = Color(0x80FF9F0A),
    thinking = Color(0xFF0A84FF),
    warningBg = Color(0x14FF9F0A),
    warningText = Color(0x73FFFFFF),
    tableBorder = Color(0xFF38383A),
    inputShadow = Color(0x80000000),
    toastBg = Color(0x2E0A84FF),
    thumbnailBorder = Color(0x20545458),
    sheetHeaderBg = Color(0xFF2C2C2E),
    sheetHeaderBorder = Color(0x33FFFFFF),
    fabAccent = Color(0xFF504C42),
)

val LocalChatPalette = compositionLocalOf { LightChatPalette }

// Short accessor: ChatColors.primaryText instead of LocalChatPalette.current.primaryText
val ChatColors: ChatPalette
    @Composable
    @ReadOnlyComposable
    get() = LocalChatPalette.current
