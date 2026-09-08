package com.openminis.app.ui

import android.net.Uri
import coil.ImageLoader
import coil.decode.DataSource
import coil.fetch.FetchResult
import coil.fetch.Fetcher
import coil.fetch.SourceResult
import coil.key.Keyer
import coil.request.Options
import com.openminis.app.sandbox.PRootKernel
import okio.buffer
import okio.source
import java.io.File

/**
 * Coil Fetcher that resolves `minis://` URIs to local files.
 *
 * Usage: Register with ImageLoader.Builder().components {
 *     add(MinisImageFetcher.Factory())
 * }
 *
 * minis://attachments/foo.jpg → /var/minis/attachments/foo.jpg → host path
 */
class MinisImageFetcher(
    private val uri: String,
    private val options: Options,
) : Fetcher {

    override suspend fun fetch(): FetchResult {
        // Strip minis:// prefix, drop any ?query, and percent-decode so
        // Chinese/emoji/space filenames resolve to the actual on-disk file.
        val stripped = uri.removePrefix("minis://").substringBefore('?')
        val decoded = java.net.URLDecoder.decode(stripped, "UTF-8")
        val linuxPath = "/var/minis/$decoded"
        val hostFile = PRootKernel.resolveHostPath(linuxPath)
            ?: throw IllegalArgumentException("Cannot resolve path: $linuxPath")

        if (!hostFile.exists()) {
            throw java.io.FileNotFoundException("File not found: ${hostFile.absolutePath}")
        }

        return SourceResult(
            source = coil.decode.ImageSource(
                source = hostFile.source().buffer(),
                context = options.context,
            ),
            mimeType = guessMimeType(hostFile),
            dataSource = DataSource.DISK,
        )
    }

    private fun guessMimeType(file: File): String? = when (file.extension.lowercase()) {
        "jpg", "jpeg" -> "image/jpeg"
        "png" -> "image/png"
        "gif" -> "image/gif"
        "webp" -> "image/webp"
        "bmp" -> "image/bmp"
        "svg" -> "image/svg+xml"
        else -> null
    }

    /**
     * String factory — matches when Coil still sees the raw model string before
     * its default mappers run. Rare in practice since Coil's StringMapper
     * converts model strings to Uri; kept as a safety net.
     */
    class Factory : Fetcher.Factory<String> {
        override fun create(data: String, options: Options, imageLoader: ImageLoader): Fetcher? {
            if (!data.startsWith("minis://")) return null
            return MinisImageFetcher(data, options)
        }
    }

    /**
     * Uri factory — the path the Markdown renderer hits. Coil's default
     * StringMapper converts an `AsyncImage(model = "minis://…")` String into
     * an android.net.Uri before fetcher resolution, so the String factory
     * above is never consulted for markdown images. Match on scheme here.
     */
    class UriFactory : Fetcher.Factory<Uri> {
        override fun create(data: Uri, options: Options, imageLoader: ImageLoader): Fetcher? {
            if (data.scheme != "minis") return null
            return MinisImageFetcher(data.toString(), options)
        }
    }

    /**
     * T-image-cache-mtime-35133: Bust Coil's memory + disk cache when a
     * `minis://` file is overwritten in-place (e.g. Grok regenerating an
     * image to the same `attachments/cat.jpg`). Without this, Coil keys
     * off the URI alone and keeps serving the previous bitmap; only the
     * ToolDetailSheet — which reads the File directly — saw the new bytes.
     *
     * The key composes `<minis-uri>?mt=<lastModified>`. The fetcher above
     * already strips `?query` before resolving, so adding the suffix here
     * does not interfere with on-disk lookup. Returning `null` falls back
     * to Coil's default keying, which is correct for non-minis data.
     *
     * Memory cache key is set by [Keyer]; disk cache key derives from the
     * same returned string in Coil 2.
     */
    class MtimeKeyer : Keyer<Uri> {
        override fun key(data: Uri, options: Options): String? {
            if (data.scheme != "minis") return null
            return composeMtimeKey(data.toString())
        }
    }

    class StringMtimeKeyer : Keyer<String> {
        override fun key(data: String, options: Options): String? {
            if (!data.startsWith("minis://")) return null
            return composeMtimeKey(data)
        }
    }

    companion object {
        private fun composeMtimeKey(uri: String): String {
            // Resolve once to fetch mtime. Cheap (single stat on host fs);
            // Coil only calls Keyer when computing/looking up cache keys,
            // not on every recomposition.
            val stripped = uri.removePrefix("minis://").substringBefore('?')
            val decoded = try {
                java.net.URLDecoder.decode(stripped, "UTF-8")
            } catch (_: Throwable) {
                stripped
            }
            val linuxPath = "/var/minis/$decoded"
            val mtime = try {
                PRootKernel.resolveHostPath(linuxPath)?.lastModified() ?: 0L
            } catch (_: Throwable) {
                0L
            }
            return "$uri?mt=$mtime"
        }
    }
}
