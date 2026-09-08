package com.openminis.app.ui.settings

import androidx.compose.foundation.background
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.openminis.app.R

/**
 * Detail screen for a single shared folder. Mirrors the iOS Folder Details
 * screen — header card (icon + name + linux path + R/W badge) and a single
 * "Browse Files" action that routes to the in-app file browser rooted at
 * the corresponding host path. The iOS-only "Show in Files app" toggle is
 * intentionally not ported (Android has no equivalent DocumentsProvider
 * mechanism wired up in this version).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SharedFolderDetailScreen(
    folderId: String,
    onBack: () -> Unit,
    onBrowseFiles: () -> Unit,
) {
    val folder = SharedFolderRegistry.find(folderId)
    if (folder == null) {
        // Unknown id — pop out so we never render an empty/broken detail.
        LaunchedEffect(Unit) { onBack() }
        return
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.shared_folder_detail_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null)
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
        ) {
            Spacer(Modifier.height(16.dp))
            HeaderCard(folder = folder)

            Spacer(Modifier.height(20.dp))
            Surface(
                color = MaterialTheme.colorScheme.surfaceContainerLow,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onBrowseFiles),
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Folder,
                        contentDescription = null,
                        tint = Color(0xFF007AFF),
                    )
                    Text(
                        text = stringResource(R.string.shared_folder_browse_files),
                        color = MaterialTheme.colorScheme.onSurface,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }

            Spacer(Modifier.height(32.dp))
        }
    }
}

@Composable
private fun HeaderCard(folder: SharedFolderEntry) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(folder.iconColor),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = folder.icon,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(20.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = stringResource(folder.nameRes),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Spacer(Modifier.width(8.dp))
                    AccessBadge(writable = folder.writable)
                }
                Spacer(Modifier.height(2.dp))
                Text(
                    text = folder.linuxPath,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun AccessBadge(writable: Boolean) {
    val (textRes, color) = if (writable) {
        R.string.mount_badge_rw to Color(0xFF34C759)
    } else {
        R.string.mount_badge_readonly to Color(0xFFFF9500)
    }
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = color.copy(alpha = 0.12f),
        contentColor = color,
    ) {
        Text(
            text = stringResource(textRes),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}
