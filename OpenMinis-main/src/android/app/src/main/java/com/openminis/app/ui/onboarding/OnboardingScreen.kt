package com.openminis.app.ui.onboarding

import com.openminis.app.R
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openminis.app.data.model.ModelEntry
import com.openminis.app.data.model.ModelGroup
import com.openminis.app.data.model.ProviderInstance
import com.openminis.app.data.model.ProviderType
import com.openminis.app.data.repository.ProviderRepository
import com.openminis.app.ui.components.MinisButton
import com.openminis.app.ui.components.MinisTextButton

/**
 * Multi-step onboarding flow shown on first launch.
 * Step 1: Welcome + add at least one provider API key
 * Step 2: Select up to 3 models to form the default model group
 */
@Composable
fun OnboardingScreen(
    providerRepository: ProviderRepository,
    onComplete: () -> Unit,
) {
    var step by remember { mutableStateOf(0) }

    when (step) {
        0 -> WelcomeStep(onNext = { step = 1 })
        1 -> ApiKeyStep(providerRepository = providerRepository, onNext = { step = 2 }, onSkip = onComplete)
        2 -> ModelSelectionStep(providerRepository = providerRepository, onComplete = onComplete)
    }
}

@Composable
private fun WelcomeStep(onNext: () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(32.dp),
        ) {
            Text(
                stringResource(R.string.onboarding_welcome_title),
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(16.dp))
            Text(
                stringResource(R.string.onboarding_welcome_subtitle),
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(48.dp))
            MinisButton(onClick = onNext, modifier = Modifier.fillMaxWidth(0.6f)) {
                Text(stringResource(R.string.onboarding_get_started))
            }
        }
    }
}

@Composable
private fun ApiKeyStep(
    providerRepository: ProviderRepository,
    onNext: () -> Unit,
    onSkip: () -> Unit,
) {
    var selectedType by remember { mutableStateOf(ProviderType.anthropic) }
    var apiKey by remember { mutableStateOf("") }
    var saved by remember { mutableStateOf(false) }

    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
        ) {
            Text(
                stringResource(R.string.onboarding_provider_title),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                stringResource(R.string.onboarding_provider_subtitle),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(24.dp))

            // Provider type selector
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                for (type in listOf(ProviderType.anthropic, ProviderType.gemini, ProviderType.openAI, ProviderType.openRouter)) {
                    val isSelected = type == selectedType
                    Card(
                        modifier = Modifier
                            .weight(1f)
                            .clickable { selectedType = type; apiKey = ""; saved = false },
                    ) {
                        Text(
                            type.displayName,
                            modifier = Modifier.padding(8.dp),
                            fontSize = 12.sp,
                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                            color = if (isSelected) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.onSurface,
                            textAlign = TextAlign.Center,
                            maxLines = 1,
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            OutlinedTextField(
                value = apiKey,
                onValueChange = { apiKey = it; saved = false },
                label = { Text(stringResource(R.string.onboarding_provider_api_key_label, selectedType.displayName)) },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )

            Spacer(Modifier.height(16.dp))

            MinisButton(
                onClick = {
                    if (apiKey.isNotBlank()) {
                        val instance = ProviderInstance(
                            id = "${selectedType.name}_onboarding",
                            label = selectedType.displayName,
                            providerType = selectedType,
                            credentialType = com.openminis.app.data.model.ProviderCredential.apiKey,
                        )
                        providerRepository.addInstance(instance)
                        providerRepository.saveApiKey(instance.id, apiKey.trim())
                        // Add built-in models
                        for (model in selectedType.builtInModels) {
                            providerRepository.addEntry(
                                ModelEntry(providerInstanceId = instance.id, baseModel = model)
                            )
                        }
                        saved = true
                    }
                },
                enabled = apiKey.isNotBlank() && !saved,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(if (saved) R.string.onboarding_saved else R.string.onboarding_save_api_key))
            }

            Spacer(Modifier.weight(1f))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                MinisTextButton(onClick = onSkip) {
                    Text(stringResource(R.string.common_skip))
                }
                MinisButton(onClick = onNext, enabled = saved) {
                    Text(stringResource(R.string.common_next))
                }
            }
        }
    }
}

@Composable
private fun ModelSelectionStep(
    providerRepository: ProviderRepository,
    onComplete: () -> Unit,
) {
    val config by providerRepository.config.collectAsState()
    val selected = remember { mutableStateListOf<String>() } // entry UUIDs
    var searchText by remember { mutableStateOf("") }

    val enabledInstanceIds = config.instances.filter { it.isEnabled }.map { it.id }.toSet()
    val allEntries = config.modelEntries.filter {
        it.providerInstanceId in enabledInstanceIds && !it.isHidden
    }
    val filteredEntries = if (searchText.isBlank()) allEntries else {
        val q = searchText.lowercase()
        allEntries.filter { it.model.displayName.lowercase().contains(q) || it.model.id.lowercase().contains(q) }
    }

    // Group by instance
    val grouped = filteredEntries.groupBy { it.providerInstanceId }

    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp),
        ) {
            Spacer(Modifier.height(16.dp))
            Text(
                stringResource(R.string.onboarding_select_models_title),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
            )
            Text(
                stringResource(R.string.onboarding_select_models_subtitle),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))

            OutlinedTextField(
                value = searchText,
                onValueChange = { searchText = it },
                label = { Text(stringResource(R.string.onboarding_search_models)) },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                shape = RoundedCornerShape(50),
            )

            Spacer(Modifier.height(8.dp))

            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                for ((instanceId, entries) in grouped) {
                    val instance = config.instances.find { it.id == instanceId }
                    item {
                        Text(
                            instance?.label ?: instanceId,
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(vertical = 8.dp),
                        )
                    }
                    items(entries, key = { it.id }) { entry ->
                        val isSelected = entry.id in selected
                        val selectionIndex = selected.indexOf(entry.id)
                        val canSelect = selected.size < 3 || isSelected

                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable(enabled = canSelect) {
                                    if (isSelected) selected.remove(entry.id)
                                    else if (selected.size < 3) selected.add(entry.id)
                                }
                                .padding(vertical = 8.dp, horizontal = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            if (isSelected) {
                                Box(
                                    modifier = Modifier
                                        .size(24.dp)
                                        .clip(CircleShape)
                                        .background(MaterialTheme.colorScheme.primary),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(
                                        "${selectionIndex + 1}",
                                        color = MaterialTheme.colorScheme.onPrimary,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold,
                                    )
                                }
                            } else {
                                Box(
                                    modifier = Modifier
                                        .size(24.dp)
                                        .clip(CircleShape)
                                        .background(MaterialTheme.colorScheme.surfaceVariant),
                                )
                            }
                            Spacer(Modifier.width(12.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(entry.model.displayName, style = MaterialTheme.typography.bodyMedium)
                                Text(
                                    entry.model.id,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        HorizontalDivider()
                    }
                }
            }

            Spacer(Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                MinisTextButton(onClick = onComplete) {
                    Text(stringResource(R.string.common_skip))
                }
                MinisButton(
                    onClick = {
                        // Create default model group from selections
                        if (selected.isNotEmpty()) {
                            val group = ModelGroup(name = "Default Models")
                            group.memberEntryIds.addAll(selected)
                            providerRepository.addGroup(group)
                            if (config.defaultPrimaryGroupId == null) {
                                providerRepository.defaultPrimaryGroupId = group.id
                            }
                        }
                        onComplete()
                    },
                    enabled = selected.isNotEmpty(),
                ) {
                    Text(stringResource(R.string.onboarding_done_count, selected.size))
                }
            }
        }
    }
}
