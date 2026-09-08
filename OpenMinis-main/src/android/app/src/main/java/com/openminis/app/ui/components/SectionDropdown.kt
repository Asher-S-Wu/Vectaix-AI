package com.openminis.app.ui.components

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle

/**
 * Dropdown selector for use inside a [SectionCard]. Visual twin of
 * [SectionTextField] — same card color/shape, same row min-height
 * (44dp), same horizontal glyph inset (16dp). Trailing icon is
 * always Icons.Default.ArrowDropDown to signal the menu affordance.
 *
 * [items] is the list of selectable values; [itemLabel] maps each
 * value to its menu/textfield display string. The current selection
 * is shown read-only in the field; tapping anywhere on the field
 * toggles the menu.
 *
 * Callers must NOT add their own `Modifier.padding(horizontal=16.dp)` — the
 * dropdown draws itself with [SectionDesign.RowHorizontalPadding] inside
 * its own card surface (matches iOS form-cell behaviour).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> SectionDropdown(
    selected: T,
    items: List<T>,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    itemLabel: (T) -> String = { it.toString() },
    textStyle: TextStyle = MaterialTheme.typography.bodyLarge,
) {
    var expanded by remember { mutableStateOf(false) }
    val interactionSource = remember { MutableInteractionSource() }
    val colors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = Color.Transparent,
        unfocusedBorderColor = Color.Transparent,
        disabledBorderColor = Color.Transparent,
        focusedContainerColor = Color.Transparent,
        unfocusedContainerColor = Color.Transparent,
        disabledContainerColor = Color.Transparent,
    )
    val contentPadding = PaddingValues(
        horizontal = SectionDesign.RowHorizontalPadding,
        vertical = SectionDesign.RowVerticalPadding,
    )
    val displayText = itemLabel(selected)
    val mergedTextStyle = LocalTextStyle.current.merge(textStyle)
    Surface(
        color = SectionDesign.cardColor(),
        shape = SectionDesign.CardShape,
        modifier = modifier.fillMaxWidth(),
    ) {
        ExposedDropdownMenuBox(
            expanded = expanded,
            onExpandedChange = { if (enabled) expanded = !expanded },
            modifier = Modifier.fillMaxWidth(),
        ) {
            BasicTextField(
                value = displayText,
                onValueChange = {},
                readOnly = true,
                enabled = enabled,
                modifier = Modifier
                    .menuAnchor()
                    .fillMaxWidth()
                    .heightIn(min = SectionDesign.RowMinHeight),
                textStyle = mergedTextStyle.copy(color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                singleLine = true,
                interactionSource = interactionSource,
                decorationBox = { innerTextField ->
                    OutlinedTextFieldDefaults.DecorationBox(
                        value = displayText,
                        innerTextField = innerTextField,
                        enabled = enabled,
                        singleLine = true,
                        visualTransformation = androidx.compose.ui.text.input.VisualTransformation.None,
                        interactionSource = interactionSource,
                        colors = colors,
                        contentPadding = contentPadding,
                        trailingIcon = {
                            Icon(
                                imageVector = Icons.Default.ArrowDropDown,
                                contentDescription = null,
                            )
                        },
                        container = {
                            OutlinedTextFieldDefaults.ContainerBox(
                                enabled = enabled,
                                isError = false,
                                interactionSource = interactionSource,
                                colors = colors,
                                shape = SectionDesign.CardShape,
                            )
                        },
                    )
                },
            )
            ExposedDropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false },
            ) {
                items.forEach { item ->
                    DropdownMenuItem(
                        text = { Text(itemLabel(item)) },
                        onClick = {
                            expanded = false
                            onSelect(item)
                        },
                    )
                }
            }
        }
    }
}
