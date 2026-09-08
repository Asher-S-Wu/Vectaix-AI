package com.openminis.app.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openminis.app.R
import com.openminis.app.data.repository.SkillRepository
import com.openminis.app.ui.components.DialogTextField
import com.openminis.app.ui.settings.SettingsSection
import com.openminis.app.ui.settings.SkillRowItem
import com.openminis.app.ui.components.MinisTextButton

/**
 * Bottom sheet showing all skills with per-session enable/disable toggles.
 * Mirrors iOS SessionSkillsView. Uses the [StandardChatSheet] shell plus the
 * shared [SettingsSection] / [SkillRowItem] primitives so each skill row
 * looks identical to the Settings → Skills screen.
 *
 * The "Enable All / Disable All" controls live to the right of the section
 * header (mirroring iOS section-actions), keeping the sheet's standard top
 * header reserved for the title + close button.
 */
@Composable
fun SessionSkillsSheet(
    sessionId: String,
    skillRepository: SkillRepository,
    onDismiss: () -> Unit,
) {
    val skills by skillRepository.skills.collectAsState()

    // [T-android-session-skill-override-init-timing] Key the seed on `skills`
    // so the override map re-derives when the live skills list arrives.
    // A keyless `remember {}` seeds once from the possibly-empty first-
    // composition list and then never re-runs, so every row's switch is stuck
    // at the global default (the same stale-override race already fixed in
    // SessionMcpsSheet — keeping the two sheets symmetric). Mirrors iOS
    // ed861471 (T-ios-session-skill-override-init-timing) for the
    // initial-state half of that fix; the per-draft id binding half is
    // already covered on Android by the `__new__<uuid>` route arg (every
    // draft has its own stable session id), unlike iOS which previously
    // coerced nil to "" and bled overrides across drafts.
    val overrides = remember(skills) {
        mutableStateMapOf<String, Boolean>().apply {
            for (skill in skills) {
                put(skill.id, skillRepository.isEnabledForSession(skill.id, sessionId))
            }
        }
    }

    var searchQuery by remember { mutableStateOf("") }
    val filteredSkills by remember(skills) {
        derivedStateOf {
            val q = searchQuery.trim().lowercase()
            if (q.isEmpty()) skills
            else skills.filter {
                it.name.lowercase().contains(q) || it.description.lowercase().contains(q)
            }
        }
    }

    StandardChatSheet(
        title = stringResource(R.string.session_skills_title),
        onDismiss = onDismiss,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        ) {
            if (skills.isEmpty()) {
                EmptySkillsCard()
            } else {
                // Search field — filters by skill name + description.
                DialogTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    placeholder = stringResource(R.string.skills_search_placeholder),
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                        .padding(top = 12.dp),
                )
                // Header row: small-caps "INSTALLED" label on the left,
                // Enable-All / Disable-All TextButtons on the right. Echoes
                // the SettingsSection header exactly so visual rhythm carries
                // over from Settings.
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 16.dp)
                        .padding(start = 32.dp, end = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = stringResource(R.string.session_skills_header_installed),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontWeight = FontWeight.Medium,
                        letterSpacing = 0.5.sp,
                    )
                    Spacer(modifier = Modifier.weight(1f))
                    // Enable/Disable All operate on the FILTERED subset so a
                    // user can bulk-toggle the result of a search.
                    MinisTextButton(
                        onClick = {
                            for (skill in filteredSkills) {
                                overrides[skill.id] = true
                                skillRepository.setSessionOverride(sessionId, skill.id, true)
                            }
                        },
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(
                            horizontal = 8.dp, vertical = 0.dp,
                        ),
                    ) {
                        Text(stringResource(R.string.session_skills_enable_all), fontSize = 12.sp)
                    }
                    MinisTextButton(
                        onClick = {
                            for (skill in filteredSkills) {
                                overrides[skill.id] = false
                                skillRepository.setSessionOverride(sessionId, skill.id, false)
                            }
                        },
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(
                            horizontal = 8.dp, vertical = 0.dp,
                        ),
                    ) {
                        Text(stringResource(R.string.session_skills_disable_all), fontSize = 12.sp)
                    }
                }

                if (filteredSkills.isEmpty()) {
                    Text(
                        text = stringResource(R.string.skills_search_no_match, searchQuery),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 32.dp, vertical = 24.dp),
                    )
                } else {
                    SettingsSection(
                        footer = stringResource(R.string.session_skills_footer),
                    ) {
                        filteredSkills.forEachIndexed { index, skill ->
                            SkillRowItem(
                                name = skill.name,
                                description = skill.description,
                                importSource = skill.importSource,
                                isEnabled = overrides[skill.id] ?: skill.isEnabled,
                                onToggle = { enabled ->
                                    overrides[skill.id] = enabled
                                    skillRepository.setSessionOverride(sessionId, skill.id, enabled)
                                },
                                showDivider = index < filteredSkills.size - 1,
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.padding(bottom = 24.dp))
            }
        }
    }
}

@Composable
private fun EmptySkillsCard() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 20.dp)
            .padding(horizontal = 16.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                Icons.Outlined.Description,
                contentDescription = null,
                modifier = Modifier.size(36.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f),
            )
            Text(
                stringResource(R.string.session_skills_empty_title),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                stringResource(R.string.session_skills_empty_subtitle),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            )
        }
    }
}
