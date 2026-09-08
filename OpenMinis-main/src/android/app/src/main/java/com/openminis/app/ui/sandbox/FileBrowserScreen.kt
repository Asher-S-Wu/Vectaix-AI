package com.openminis.app.ui.sandbox

import com.openminis.app.R
import androidx.compose.ui.res.stringResource
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.AudioFile
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.AppShortcut
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.ui.platform.LocalContext
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material.icons.filled.VideoFile
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.openminis.app.ui.components.MinisTextButton

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileBrowserScreen(
    viewModel: FileBrowserViewModel,
    onBack: () -> Unit,
    onPreviewFile: (FileItem) -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    var deleteTarget by remember { mutableStateOf<FileItem?>(null) }
    // T-pwa-3: long-press → "Add to Home Screen" sheet, hosted at screen
    // scope so the dropdown can dismiss before the bottom-sheet appears.
    var webAppSheetSource by remember { mutableStateOf<com.openminis.app.webapp.WebAppSource.HostFile?>(null) }

    // When navigated into a subdirectory, the top-bar back button and the
    // system back gesture both pop one directory level first. The
    // ViewModel's `goBack()` returns `false` when we're already at the
    // initial entry directory (T145) — at that point we exit the screen
    // entirely rather than crawling further up toward the rootfs root,
    // mirroring iOS FileBrowserView. The state.canGoBack pre-check is
    // kept for the same shortcut and to flip the back button into a
    // pure "close" affordance once the user is back at the entry dir.
    val handleBack = {
        if (!state.canGoBack || !viewModel.goBack()) onBack()
    }

    BackHandler(enabled = true, onBack = handleBack)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.filebrowser_title)) },
                navigationIcon = {
                    IconButton(onClick = handleBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                },
                actions = {
                    // T-hidden-files a3e7f1d0: trailing toolbar collapsed
                    // to a single ⋯ menu (was a Sort-only IconButton). All
                    // functional actions now live under one entry point.
                    MoreMenu(
                        sortKey = state.sortKey,
                        ascending = state.sortAscending,
                        foldersFirst = state.foldersFirst,
                        showHidden = state.showHidden,
                        onSelectKey = { viewModel.setSort(key = it) },
                        onToggleDirection = { viewModel.setSort(ascending = !state.sortAscending) },
                        onToggleFoldersFirst = { viewModel.setSort(foldersFirst = !state.foldersFirst) },
                        onToggleShowHidden = { viewModel.setShowHidden(!state.showHidden) },
                    )
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            // Breadcrumb bar
            BreadcrumbBar(
                pathComponents = state.pathComponents,
                onNavigate = { index -> viewModel.navigateToPathComponent(index) },
            )

            HorizontalDivider()

            // Content
            when {
                state.isLoading -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator()
                    }
                }

                state.isEmpty -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(
                                Icons.Filled.Folder,
                                contentDescription = null,
                                modifier = Modifier.size(48.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(
                                stringResource(R.string.filebrowser_empty_folder),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodyMedium,
                            )
                        }
                    }
                }

                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(vertical = 4.dp),
                    ) {
                        items(state.items, key = { it.file.absolutePath }) { item ->
                            FileItemRow(
                                item = item,
                                currentLinuxPath = state.currentLinuxPath,
                                onClick = {
                                    if (item.isDirectory) {
                                        viewModel.navigateTo(item)
                                    } else {
                                        onPreviewFile(item)
                                    }
                                },
                                onDelete = { deleteTarget = item },
                                onAddToHome = { source -> webAppSheetSource = source },
                            )
                            HorizontalDivider(modifier = Modifier.padding(start = 56.dp))
                        }
                    }
                }
            }
        }
    }

    // Delete confirmation
    deleteTarget?.let { item ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text(stringResource(R.string.filebrowser_delete_title, item.name)) },
            text = { Text(stringResource(R.string.filebrowser_delete_message)) },
            confirmButton = {
                MinisTextButton(onClick = {
                    viewModel.deleteItem(item)
                    deleteTarget = null
                }) {
                    Text(stringResource(R.string.delete), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                MinisTextButton(onClick = { deleteTarget = null }) {
                    Text(stringResource(R.string.cancel))
                }
            },
        )
    }

    // T-pwa-3: Add-to-Home-Screen sheet, hosted at screen scope so it
    // outlives the row that triggered it (rows scroll out of composition
    // and the menu dismisses before the sheet animates in).
    webAppSheetSource?.let { src ->
        com.openminis.app.webapp.AddToHomeSheet(
            source = src,
            onDismiss = { webAppSheetSource = null },
        )
    }

    // Error dialog
    state.errorMessage?.let { msg ->
        AlertDialog(
            onDismissRequest = { viewModel.dismissError() },
            title = { Text(stringResource(R.string.filebrowser_error_title)) },
            text = { Text(msg) },
            confirmButton = {
                MinisTextButton(onClick = { viewModel.dismissError() }) {
                    Text("OK")  // OK is locale-neutral
                }
            },
        )
    }
}

@Composable
private fun BreadcrumbBar(
    pathComponents: List<String>,
    onNavigate: (Int) -> Unit,
) {
    val scrollState = rememberScrollState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(scrollState)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        pathComponents.forEachIndexed { index, component ->
            Text(
                text = component,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.clickable { onNavigate(index) },
            )
            if (index < pathComponents.lastIndex) {
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FileItemRow(
    item: FileItem,
    currentLinuxPath: String?,
    onClick: () -> Unit,
    onDelete: () -> Unit,
    onAddToHome: (com.openminis.app.webapp.WebAppSource.HostFile) -> Unit,
) {
    // T-pwa-3: long-press menu for .html / .htm files whose host path
    // sits under a recognised PRoot bind mount (`/var/minis/shared` or
    // `/var/minis/mounts/<n>`). Computed lazily because the bindMounts
    // map can change while the screen is open (mount add/remove).
    val ext = item.file.extension.lowercase()
    val isHtml = !item.isDirectory && (ext == "html" || ext == "htm")
    var menuExpanded by remember(item.file.absolutePath) { mutableStateOf(false) }

    // [T-android-file-context-copy-abs-path] The file's Linux (PRoot) absolute
    // path = current dir's linux path + name. Falls back to the host absolute
    // path when this browser isn't rooted under a bind mount (raw host view).
    val absolutePath = currentLinuxPath?.let { "${it.trimEnd('/')}/${item.name}" }
        ?: item.file.absolutePath

    Box {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .combinedClickable(
                onClick = onClick,
                // [T-android-file-context-copy-abs-path] Long-press opens the
                // file context menu (currently "Copy Absolute Path"; the
                // HTML-only "Add to Home" item below stays gated). Mirrors the
                // iOS file context menu.
                onLongClick = { menuExpanded = true },
            )
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Icon
        Icon(
            imageVector = fileIcon(item),
            contentDescription = null,
            modifier = Modifier.size(24.dp),
            tint = if (item.isDirectory)
                MaterialTheme.colorScheme.primary
            else
                MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(modifier = Modifier.width(16.dp))

        // Name and size
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = item.name,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (item.isSymlink) {
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        text = "link",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.tertiary,
                    )
                }
            }
            // mtime + size on a single row, mirroring iOS: "size · mtime"
            // (size omitted for directories, mtime omitted when stat = 0).
            val mtime = item.formattedDate
            if (!item.isDirectory || mtime.isNotEmpty()) {
                val parts = buildList {
                    if (!item.isDirectory) add(item.formattedSize)
                    if (mtime.isNotEmpty()) add(mtime)
                }
                Text(
                    text = parts.joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // Delete button for non-directory items
        if (!item.isDirectory) {
            IconButton(onClick = onDelete, modifier = Modifier.size(32.dp)) {
                Icon(
                    Icons.Filled.Delete,
                    contentDescription = stringResource(R.string.delete),
                    modifier = Modifier.size(18.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // Chevron for directories
        if (item.isDirectory) {
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }

    // [T-android-file-context-copy-abs-path] File context menu, anchored to
    // the row's bounding Box. Always offers "Copy Absolute Path"; the
    // HTML-only "Add to Home" item below stays gated behind the unvalidated
    // WebApp entry point (TODO webapp-hidden).
    run {
        val context = LocalContext.current
        com.openminis.app.ui.components.MinisMenu(
            expanded = menuExpanded,
            onDismissRequest = { menuExpanded = false },
        ) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.filebrowser_copy_abs_path)) },
                leadingIcon = {
                    Icon(Icons.Filled.ContentCopy, contentDescription = null)
                },
                onClick = {
                    menuExpanded = false
                    val clip = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE)
                        as android.content.ClipboardManager
                    clip.setPrimaryClip(
                        android.content.ClipData.newPlainText("path", absolutePath),
                    )
                    // Android 13+ shows its own clipboard confirmation chip;
                    // add a Toast for < 13 and as explicit feedback.
                    android.widget.Toast.makeText(
                        context,
                        context.getString(R.string.filebrowser_copy_abs_path_toast),
                        android.widget.Toast.LENGTH_SHORT,
                    ).show()
                },
            )
            // TODO(webapp-hidden): WebApp / "Add to Home Screen" item temporarily
            // hidden — feature not yet validated/complete. Re-enable by removing
            // `false &&` from the guard below.
            if (false && isHtml) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.webapp_add_to_home)) },
                leadingIcon = {
                    Icon(Icons.Filled.AppShortcut, contentDescription = null)
                },
                onClick = {
                    menuExpanded = false
                    val triple = com.openminis.app.webapp.WebAppPathResolver.inferScope(item.file)
                    if (triple != null) {
                        val (scope, ctx, linuxPath) = triple
                        onAddToHome(
                            com.openminis.app.webapp.WebAppSource.HostFile(
                                file = item.file,
                                fileName = item.name,
                                pathScope = scope,
                                scopeContext = ctx,
                                linuxPath = linuxPath,
                            ),
                        )
                    }
                    // No matching scope → silently no-op (chip is rare and
                    // only appears for files that do live under a bind mount;
                    // future T-pwa-4 may surface a toast).
                },
            )
            } // end HTML-only Add-to-Home gate
        }
    }
    } // anchoring Box
}

@Composable
private fun MoreMenu(
    sortKey: FileSortKey,
    ascending: Boolean,
    foldersFirst: Boolean,
    showHidden: Boolean,
    onSelectKey: (FileSortKey) -> Unit,
    onToggleDirection: () -> Unit,
    onToggleFoldersFirst: () -> Unit,
    onToggleShowHidden: () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { expanded = true }) {
            Icon(Icons.Filled.MoreVert, contentDescription = stringResource(R.string.filebrowser_more_action))
        }
        com.openminis.app.ui.components.MinisMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            // Display options — sort key choices first so the most
            // frequent toggle (sort) is the closest tap.
            for (key in FileSortKey.entries) {
                DropdownMenuItem(
                    text = { Text(stringResource(when (key) {
                        FileSortKey.NAME -> R.string.filebrowser_sort_name
                        FileSortKey.MODIFIED -> R.string.filebrowser_sort_modified
                        FileSortKey.SIZE -> R.string.filebrowser_sort_size
                        FileSortKey.KIND -> R.string.filebrowser_sort_kind
                    })) },
                    leadingIcon = {
                        if (key == sortKey) {
                            Icon(Icons.Filled.Check, contentDescription = null)
                        } else {
                            Spacer(modifier = Modifier.size(24.dp))
                        }
                    },
                    onClick = {
                        onSelectKey(key)
                        expanded = false
                    },
                )
            }
            HorizontalDivider()
            DropdownMenuItem(
                text = { Text(stringResource(if (ascending) R.string.filebrowser_sort_ascending else R.string.filebrowser_sort_descending)) },
                leadingIcon = {
                    Icon(
                        if (ascending) Icons.Filled.ArrowUpward else Icons.Filled.ArrowDownward,
                        contentDescription = null,
                    )
                },
                onClick = {
                    onToggleDirection()
                    expanded = false
                },
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.filebrowser_sort_folders_first)) },
                leadingIcon = {
                    if (foldersFirst) {
                        Icon(Icons.Filled.Check, contentDescription = null)
                    } else {
                        Spacer(modifier = Modifier.size(24.dp))
                    }
                },
                onClick = {
                    onToggleFoldersFirst()
                    expanded = false
                },
            )
            DropdownMenuItem(
                text = {
                    Text(stringResource(
                        if (showHidden) R.string.filebrowser_hide_hidden
                        else R.string.filebrowser_show_hidden
                    ))
                },
                leadingIcon = {
                    Icon(
                        if (showHidden) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                        contentDescription = null,
                    )
                },
                onClick = {
                    onToggleShowHidden()
                    expanded = false
                },
            )
        }
    }
}

private fun fileIcon(item: FileItem): ImageVector {
    if (item.isDirectory) return Icons.Filled.Folder
    return when (item.iconRes) {
        "text" -> Icons.Filled.Description
        "terminal" -> Icons.Filled.Terminal
        "code" -> Icons.Filled.Code
        "image" -> Icons.Filled.Image
        "audio" -> Icons.Filled.AudioFile
        "video" -> Icons.Filled.VideoFile
        "archive" -> Icons.Filled.Archive
        "pdf" -> Icons.Filled.PictureAsPdf
        "database" -> Icons.Filled.Storage
        else -> Icons.AutoMirrored.Filled.InsertDriveFile
    }
}
