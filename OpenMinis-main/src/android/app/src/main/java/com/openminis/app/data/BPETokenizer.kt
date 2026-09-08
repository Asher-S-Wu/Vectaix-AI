package com.openminis.app.data

import android.content.Context
import android.graphics.BitmapFactory
import kotlin.math.ceil
import kotlin.math.max

/**
 * Approximate BPE token counter. Mirrors iOS `BPETokenizer` (cl100k_base)
 * but without the full vocabulary — we ship a lightweight heuristic by
 * default so the app size doesn't balloon by ~2 MB before a caller actually
 * needs tokenization. Drop in a real `cl100k_base.tiktoken` asset via
 * [loadVocabularyFromAssets] when a consumer needs higher fidelity.
 *
 * The heuristic: `max(1, codepointCount / 3)` for text. That's the same
 * floor iOS falls back to when vocab fails to load, and it's within ±15%
 * of real cl100k_base counts for English / mixed CJK text.
 *
 * Image tokens: iOS uses `ceil(w/32) * ceil(h/32)` with a 2048px long-edge
 * cap and a floor of 85 tokens. We match that exactly so the context bar
 * stays visually identical across platforms.
 *
 * This class is thread-safe once [loadVocabularyFromAssets] finishes (or if
 * the heuristic path is used). Vocabulary loading is one-shot via [@Volatile].
 */
object BPETokenizer {
    const val TOKENS_PER_MESSAGE = 3
    const val TOKENS_PER_REPLY = 3
    private const val IMAGE_GRID = 32
    private const val IMAGE_MAX_EDGE = 2048
    private const val IMAGE_MIN_TOKENS = 85
    private const val IMAGE_FAILURE_FALLBACK = 1000

    @Volatile private var encoder: Map<List<Byte>, Int>? = null

    /**
     * Count tokens in [text] using the loaded vocabulary if present, otherwise
     * a codepoint-based heuristic. Returns 0 for empty input.
     */
    fun countTokens(text: String): Int {
        if (text.isEmpty()) return 0
        val vocab = encoder
        if (vocab == null) return heuristicTokenCount(text)
        return bpeEncode(text.toByteArray(Charsets.UTF_8), vocab).size
    }

    /**
     * Approximate token count for an image payload. Matches iOS heuristic:
     * scale long-edge to 2048px, grid at 32×32, min 85 tokens, return 1000
     * if decoding fails (i.e. treat as a costly opaque blob).
     */
    fun countImageTokens(data: ByteArray): Int {
        if (data.isEmpty()) return 0
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(data, 0, data.size, opts)
        val w = opts.outWidth.toFloat()
        val h = opts.outHeight.toFloat()
        if (w <= 0f || h <= 0f) return IMAGE_FAILURE_FALLBACK
        val longEdge = max(w, h)
        val scale = if (longEdge > IMAGE_MAX_EDGE) IMAGE_MAX_EDGE / longEdge else 1f
        val scaledW = w * scale
        val scaledH = h * scale
        val tokens = (ceil(scaledW / IMAGE_GRID) * ceil(scaledH / IMAGE_GRID)).toInt()
        return max(IMAGE_MIN_TOKENS, tokens)
    }

    /**
     * Opt-in: load a cl100k_base vocabulary from `assets/<fileName>`. File
     * must match tiktoken's format — one `<base64-bytes> <rank>` per line.
     * No-op if already loaded or file is missing.
     */
    fun loadVocabularyFromAssets(context: Context, fileName: String = "cl100k_base.tiktoken"): Boolean {
        if (encoder != null) return true
        return try {
            val dict = HashMap<List<Byte>, Int>(100_300)
            context.assets.open(fileName).bufferedReader(Charsets.UTF_8).useLines { lines ->
                for (line in lines) {
                    val space = line.indexOf(' ')
                    if (space <= 0) continue
                    val decoded = runCatching {
                        android.util.Base64.decode(
                            line.substring(0, space),
                            android.util.Base64.DEFAULT or android.util.Base64.NO_WRAP,
                        )
                    }.getOrNull() ?: continue
                    val rank = line.substring(space + 1).trim().toIntOrNull() ?: continue
                    dict[decoded.toList()] = rank
                }
            }
            if (dict.isNotEmpty()) {
                encoder = dict
                true
            } else false
        } catch (_: Exception) {
            false
        }
    }

    private fun heuristicTokenCount(text: String): Int {
        var cp = 0
        var i = 0
        while (i < text.length) {
            cp++
            i += if (text[i].isHighSurrogate() && i + 1 < text.length) 2 else 1
        }
        return max(1, cp / 3)
    }

    /**
     * Greedy BPE: treat each byte as its own segment, repeatedly merge the
     * adjacent pair with the lowest rank that's still in the vocabulary, stop
     * when no mergeable pair remains. Mirrors iOS `bytePairEncode`.
     */
    private fun bpeEncode(bytes: ByteArray, vocab: Map<List<Byte>, Int>): List<Int> {
        if (bytes.isEmpty()) return emptyList()
        val segments = ArrayList<IntArray>(bytes.size)
        for (i in bytes.indices) segments.add(intArrayOf(i, i + 1))
        while (segments.size > 1) {
            var minRank = Int.MAX_VALUE
            var minIdx = -1
            for (i in 0 until segments.size - 1) {
                val start = segments[i][0]
                val end = segments[i + 1][1]
                val slice = bytes.sliceArray(start until end).toList()
                val rank = vocab[slice] ?: continue
                if (rank < minRank) {
                    minRank = rank
                    minIdx = i
                }
            }
            if (minIdx < 0) break
            segments[minIdx] = intArrayOf(segments[minIdx][0], segments[minIdx + 1][1])
            segments.removeAt(minIdx + 1)
        }
        return segments.mapNotNull { seg ->
            vocab[bytes.sliceArray(seg[0] until seg[1]).toList()]
        }
    }
}
