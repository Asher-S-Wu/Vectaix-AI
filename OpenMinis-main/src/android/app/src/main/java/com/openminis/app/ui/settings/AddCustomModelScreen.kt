package com.openminis.app.ui.settings

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import com.openminis.app.data.model.LLMModel
import com.openminis.app.data.model.ModelEntry
import com.openminis.app.data.repository.ProviderRepository
import com.openminis.app.ui.components.RowLabel
import com.openminis.app.ui.components.SectionTextField
import com.openminis.app.R
import com.openminis.app.ui.components.MinisButton

/**
 * Add Custom Model — adopts the SettingsScaffold/SettingsSection toolkit
 * (T78). Single Identity section grouping the Model ID + Display Name
 * fields, with a footer caption explaining what the fields are for.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddCustomModelScreen(
    instanceId: String,
    providerRepository: ProviderRepository,
    onBack: () -> Unit,
) {
    val instance = providerRepository.instance(instanceId)

    if (instance == null) {
        onBack()
        return
    }

    var modelId by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }

    SettingsScaffold(
        title = stringResource(R.string.provider_detail_add_custom_model),
        onBack = onBack,
    ) {
        SettingsSection(
            header = stringResource(R.string.add_provider_identity),
            footer = stringResource(R.string.add_custom_model_id_footer, instance.providerType.displayName),
        ) {
            SettingsCardBlock {
                RowLabel(text = stringResource(R.string.add_custom_model_model_id))
                SectionTextField(
                    value = modelId,
                    onValueChange = { modelId = it },
                    placeholder = stringResource(R.string.add_custom_model_eg_id_placeholder),
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                )
                Spacer(Modifier.height(12.dp))
                RowLabel(text = stringResource(R.string.add_custom_model_display_name_optional))
                SectionTextField(
                    value = displayName,
                    onValueChange = { displayName = it },
                    singleLine = true,
                )
            }
        }

        Spacer(Modifier.height(20.dp))
        MinisButton(
            onClick = {
                val name = displayName.ifBlank { modelId }
                val model = LLMModel(
                    id = modelId.trim(),
                    displayName = name.trim(),
                    provider = instance.providerType.displayName,
                )
                val entry = ModelEntry(
                    providerInstanceId = instanceId,
                    baseModel = model,
                    isCustom = true,
                )
                providerRepository.addEntry(entry)
                onBack()
            },
            enabled = modelId.isNotBlank(),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
        ) {
            Text(stringResource(R.string.common_save))
        }
        Spacer(Modifier.height(20.dp))
    }
}
