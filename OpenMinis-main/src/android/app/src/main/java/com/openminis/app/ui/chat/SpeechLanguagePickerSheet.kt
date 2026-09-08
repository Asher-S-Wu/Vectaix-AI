package com.openminis.app.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openminis.app.R
import com.openminis.app.speech.SpeechRecognitionManager
import com.openminis.app.ui.theme.ChatColors
import java.util.Locale

/**
 * Modal sheet listing the active recognizer's supported languages. Tapping a
 * row selects the locale (which, if called during an active session, cancels
 * and restarts recognition in the new language — see
 * [SpeechRecognitionManager.selectLocale]).
 *
 * Locales are sorted so anything matching the device's system preferences
 * floats to the top, then the remainder alphabetically by display name.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SpeechLanguagePickerSheet(
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState()
    val supported by SpeechRecognitionManager.supportedLocales.collectAsState()
    val current by SpeechRecognitionManager.locale.collectAsState()

    val ordered = remember(supported) {
        val systemLang = Locale.getDefault().language
        supported.sortedWith(
            compareByDescending<Locale> { it.language == systemLang }
                .thenBy { it.getDisplayName(Locale.getDefault()) }
        )
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = ChatColors.background,
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Text(
                text = stringResource(R.string.speech_lang_picker_title),
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = ChatColors.primaryText,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
            )
            if (ordered.isEmpty()) {
                Text(
                    text = stringResource(R.string.speech_lang_picker_empty),
                    fontSize = 13.sp,
                    color = ChatColors.secondaryText,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                )
            } else {
                LazyColumn(modifier = Modifier.fillMaxWidth()) {
                    items(ordered, key = { it.toLanguageTag() }) { locale ->
                        val selected = locale.toLanguageTag() == current.toLanguageTag()
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    SpeechRecognitionManager.selectLocale(locale)
                                    onDismiss()
                                }
                                .padding(horizontal = 20.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(30.dp)
                                    .background(ChatColors.secondaryBg, CircleShape),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    text = locale.language.uppercase().take(2),
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = ChatColors.primaryText,
                                )
                            }
                            Spacer(modifier = Modifier.size(12.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = locale.getDisplayName(locale).ifEmpty { locale.toLanguageTag() },
                                    fontSize = 15.sp,
                                    color = ChatColors.primaryText,
                                )
                                Text(
                                    text = locale.toLanguageTag(),
                                    fontSize = 12.sp,
                                    color = ChatColors.secondaryText,
                                )
                            }
                            if (selected) {
                                Icon(
                                    imageVector = Icons.Default.Check,
                                    contentDescription = stringResource(R.string.speech_lang_picker_selected),
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(20.dp),
                                )
                            }
                        }
                    }
                }
            }
            Spacer(modifier = Modifier.height(12.dp))
        }
    }
}
