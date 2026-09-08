package com.openminis.app.providers

import android.database.Cursor
import android.database.MatrixCursor
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract.Document
import android.provider.DocumentsContract.Root
import android.provider.DocumentsProvider
import android.webkit.MimeTypeMap
import java.io.File
import java.io.FileNotFoundException

/**
 * Exposes `<filesDir>/minis-global/{memory,skills,shared}` to the system
 * Files app as a storage root. Mirrors iOS `FileProviderExtension`
 * (spec_FileMount §1). Runs in the main app process — no IPC / no
 * independent extension target needed on Android.
 *
 * Capabilities match iOS:
 *   - `memory/` and `skills/` are read-only (tools own their content)
 *   - `shared/` accepts new subitems and in-place edits
 *   - root itself is read-only (can't create a new top-level folder)
 *
 * **Manifest registration is not yet wired.** AndroidManifest.xml has
 * pre-existing in-flight edits this commit can't touch — once that file
 * gets its own cleanup commit, add:
 * ```xml
 * <provider android:name=".providers.MinisDocumentsProvider"
 *     android:authorities="com.openminis.minis.documents"
 *     android:exported="true"
 *     android:grantUriPermissions="true"
 *     android:permission="android.permission.MANAGE_DOCUMENTS">
 *   <intent-filter>
 *     <action android:name="android.content.action.DOCUMENTS_PROVIDER" />
 *   </intent-filter>
 * </provider>
 * ```
 * Until then this class compiles cleanly but is unreachable by the
 * Files app.
 */
class MinisDocumentsProvider : DocumentsProvider() {

    companion object {
        const val AUTHORITY = "com.openminis.minis.documents"
        private const val ROOT_ID = "minis-root"
        private const val ROOT_DOC_ID = ""        // empty = providerRoot
        private val TOP_LEVEL = listOf("memory", "skills", "shared")
        private val READ_ONLY_TOP = setOf("memory", "skills")
        /** Never expose internal metadata that happens to sit in filesDir. */
        private val METADATA_BLACKLIST = setOf(
            "mounted-folders.json",
            "logs",
            ".",
            "..",
        )

        private val ROOT_PROJECTION = arrayOf(
            Root.COLUMN_ROOT_ID,
            Root.COLUMN_FLAGS,
            Root.COLUMN_ICON,
            Root.COLUMN_TITLE,
            Root.COLUMN_DOCUMENT_ID,
            Root.COLUMN_MIME_TYPES,
        )

        private val DOCUMENT_PROJECTION = arrayOf(
            Document.COLUMN_DOCUMENT_ID,
            Document.COLUMN_MIME_TYPE,
            Document.COLUMN_DISPLAY_NAME,
            Document.COLUMN_LAST_MODIFIED,
            Document.COLUMN_FLAGS,
            Document.COLUMN_SIZE,
        )
    }

    override fun onCreate(): Boolean = true

    private fun providerRoot(): File {
        val ctx = context ?: throw IllegalStateException("Provider has no context")
        return File(ctx.filesDir, "minis-global").apply { mkdirs() }
    }

    private fun resolveDoc(documentId: String): File {
        val root = providerRoot()
        val clean = documentId.trim().trim('/')
        if (clean.isEmpty()) return root
        if (clean.contains("..")) throw FileNotFoundException("Invalid path: $documentId")
        return File(root, clean)
    }

    private fun documentIdFor(file: File): String {
        val rootPath = providerRoot().absolutePath
        val abs = file.absolutePath
        if (abs == rootPath) return ROOT_DOC_ID
        if (!abs.startsWith("$rootPath/")) throw FileNotFoundException("Outside provider root: $abs")
        return abs.substring(rootPath.length + 1)
    }

    private fun flagsFor(documentId: String, file: File): Int {
        if (documentId.isEmpty()) return 0 // root is immutable through SAF
        val topLevel = documentId.substringBefore('/')
        val isTop = documentId.indexOf('/') < 0
        if (topLevel in READ_ONLY_TOP) {
            return if (isTop && file.isDirectory) Document.FLAG_DIR_PREFERS_LAST_MODIFIED else 0
        }
        // `shared/` tree is writable.
        var flags = 0
        if (file.isDirectory) flags = flags or Document.FLAG_DIR_SUPPORTS_CREATE
        else flags = flags or Document.FLAG_SUPPORTS_WRITE
        flags = flags or Document.FLAG_SUPPORTS_DELETE or Document.FLAG_SUPPORTS_RENAME
        return flags
    }

    private fun mimeFor(file: File): String {
        if (file.isDirectory) return Document.MIME_TYPE_DIR
        val ext = file.extension.lowercase()
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
    }

    override fun queryRoots(projection: Array<String>?): Cursor {
        val cursor = MatrixCursor(projection ?: ROOT_PROJECTION)
        cursor.newRow()
            .add(Root.COLUMN_ROOT_ID, ROOT_ID)
            .add(Root.COLUMN_FLAGS, Root.FLAG_LOCAL_ONLY or Root.FLAG_SUPPORTS_IS_CHILD)
            .add(Root.COLUMN_TITLE, "Minis")
            .add(Root.COLUMN_DOCUMENT_ID, ROOT_DOC_ID)
            .add(Root.COLUMN_MIME_TYPES, "*/*")
            .add(Root.COLUMN_ICON, 0)
        return cursor
    }

    override fun queryDocument(documentId: String, projection: Array<String>?): Cursor {
        val cursor = MatrixCursor(projection ?: DOCUMENT_PROJECTION)
        val file = resolveDoc(documentId)
        val displayName = if (documentId.isEmpty()) "Minis" else file.name
        cursor.newRow()
            .add(Document.COLUMN_DOCUMENT_ID, documentId)
            .add(Document.COLUMN_DISPLAY_NAME, displayName)
            .add(Document.COLUMN_MIME_TYPE, mimeFor(file))
            .add(Document.COLUMN_LAST_MODIFIED, file.lastModified())
            .add(Document.COLUMN_FLAGS, flagsFor(documentId, file))
            .add(Document.COLUMN_SIZE, if (file.isFile) file.length() else 0L)
        return cursor
    }

    override fun queryChildDocuments(
        parentDocumentId: String,
        projection: Array<String>?,
        sortOrder: String?,
    ): Cursor {
        val cursor = MatrixCursor(projection ?: DOCUMENT_PROJECTION)
        val parent = resolveDoc(parentDocumentId)
        val isRoot = parentDocumentId.isEmpty()
        val children = parent.listFiles()?.toList() ?: emptyList()
        for (child in children) {
            val name = child.name
            if (name.startsWith(".")) continue
            if (name in METADATA_BLACKLIST) continue
            if (isRoot && name !in TOP_LEVEL) continue
            val docId = if (parentDocumentId.isEmpty()) name else "$parentDocumentId/$name"
            cursor.newRow()
                .add(Document.COLUMN_DOCUMENT_ID, docId)
                .add(Document.COLUMN_DISPLAY_NAME, name)
                .add(Document.COLUMN_MIME_TYPE, mimeFor(child))
                .add(Document.COLUMN_LAST_MODIFIED, child.lastModified())
                .add(Document.COLUMN_FLAGS, flagsFor(docId, child))
                .add(Document.COLUMN_SIZE, if (child.isFile) child.length() else 0L)
        }
        return cursor
    }

    override fun openDocument(
        documentId: String,
        mode: String,
        signal: CancellationSignal?,
    ): ParcelFileDescriptor {
        val file = resolveDoc(documentId)
        val parcelMode = ParcelFileDescriptor.parseMode(mode)
        // Reject writes against the read-only subtrees even if the client
        // ignored the flags cursor — belt + suspenders for AI skills.
        if (parcelMode and ParcelFileDescriptor.MODE_WRITE_ONLY != 0 ||
            parcelMode and ParcelFileDescriptor.MODE_READ_WRITE != 0
        ) {
            val top = documentId.substringBefore('/')
            if (top in READ_ONLY_TOP) {
                throw UnsupportedOperationException("$top is read-only")
            }
        }
        return ParcelFileDescriptor.open(file, parcelMode)
    }

    override fun createDocument(
        parentDocumentId: String,
        mimeType: String,
        displayName: String,
    ): String {
        val parent = resolveDoc(parentDocumentId)
        val top = parentDocumentId.substringBefore('/').ifEmpty { parentDocumentId }
        if (top in READ_ONLY_TOP) throw UnsupportedOperationException("$top is read-only")
        val safeName = displayName.replace("/", "_").replace("..", "_")
        val created = File(parent, safeName)
        val ok = if (mimeType == Document.MIME_TYPE_DIR) created.mkdirs() else created.createNewFile()
        if (!ok && !created.exists()) throw FileNotFoundException("Failed to create $safeName")
        return documentIdFor(created)
    }

    override fun deleteDocument(documentId: String) {
        val file = resolveDoc(documentId)
        val top = documentId.substringBefore('/')
        if (top in READ_ONLY_TOP) throw UnsupportedOperationException("$top is read-only")
        if (!file.deleteRecursively()) throw FileNotFoundException("Failed to delete $documentId")
    }

    override fun renameDocument(documentId: String, displayName: String): String {
        val file = resolveDoc(documentId)
        val top = documentId.substringBefore('/')
        if (top in READ_ONLY_TOP) throw UnsupportedOperationException("$top is read-only")
        val safe = displayName.replace("/", "_").replace("..", "_")
        val target = File(file.parentFile, safe)
        if (!file.renameTo(target)) throw FileNotFoundException("Failed to rename $documentId")
        return documentIdFor(target)
    }
}
