package com.openminis.app.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * T-pwa-1 (renamed Pwa → WebApp): stores user-pinned WebApp shortcuts.
 * Each row maps a pinned home-screen icon back to a stored HTML file
 * plus the scope info needed to resolve `htmlPath` to a real on-device
 * path at launch time.
 *
 * `pathScope` is one of: `session_attachment`, `shared`, `mount`.
 * `scopeContext` is the per-scope discriminator:
 *   - session_attachment → sessionId
 *   - shared             → null (resolved via global bind mounts)
 *   - mount              → mount key (e.g. `/var/minis/mounts/<name>`)
 *
 * `iconRef` describes the icon source: `preset:<name>`, `file:<path>`,
 * or `html` (extracted from the page's <link rel=icon>).
 * `iconCachePath` is the cached PNG path inside `filesDir/webapp_icons/`.
 *
 * Table name `webapp_shortcuts` matches iOS Core Data store renamed in
 * commit e195ead (refactor(ios): rename Pwa → WebApp).
 */
@Entity(tableName = "webapp_shortcuts")
data class WebAppShortcutEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "html_path") val htmlPath: String,
    @ColumnInfo(name = "path_scope") val pathScope: String,
    @ColumnInfo(name = "scope_context") val scopeContext: String?,
    val title: String,
    @ColumnInfo(name = "icon_ref") val iconRef: String,
    @ColumnInfo(name = "icon_cache_path") val iconCachePath: String?,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "source_session_id") val sourceSessionId: String?,
)
