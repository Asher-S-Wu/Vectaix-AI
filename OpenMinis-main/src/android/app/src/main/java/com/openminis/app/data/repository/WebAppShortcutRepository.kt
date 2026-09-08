package com.openminis.app.data.repository

import com.openminis.app.data.db.WebAppShortcutDao
import com.openminis.app.data.db.WebAppShortcutEntity
import java.util.UUID

/**
 * T-pwa-1 (renamed Pwa → WebApp): thin wrapper around
 * [WebAppShortcutDao]. Constructed once in [com.openminis.app.MinisApp]
 * and shared across UI surfaces (chat attachment chip in T-pwa-2, file
 * browser row in T-pwa-3).
 */
class WebAppShortcutRepository(private val dao: WebAppShortcutDao) {

    suspend fun create(
        htmlPath: String,
        pathScope: String,
        scopeContext: String?,
        title: String,
        iconRef: String,
        iconCachePath: String?,
        sourceSessionId: String?,
    ): WebAppShortcutEntity {
        val entity = WebAppShortcutEntity(
            id = UUID.randomUUID().toString(),
            htmlPath = htmlPath,
            pathScope = pathScope,
            scopeContext = scopeContext,
            title = title,
            iconRef = iconRef,
            iconCachePath = iconCachePath,
            createdAt = System.currentTimeMillis(),
            sourceSessionId = sourceSessionId,
        )
        dao.insert(entity)
        return entity
    }

    suspend fun get(id: String): WebAppShortcutEntity? = dao.getById(id)

    suspend fun list(): List<WebAppShortcutEntity> = dao.getAll()

    suspend fun delete(id: String) = dao.deleteById(id)

    suspend fun update(entity: WebAppShortcutEntity) = dao.update(entity)

    companion object {
        const val SCOPE_SESSION_ATTACHMENT = "session_attachment"
        const val SCOPE_SHARED = "shared"
        const val SCOPE_MOUNT = "mount"
    }
}
