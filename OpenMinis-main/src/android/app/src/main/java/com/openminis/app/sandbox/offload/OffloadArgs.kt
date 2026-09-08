package com.openminis.app.sandbox.offload

/**
 * Tiny long-option parser shared by android-* offload handlers.
 *
 * Supports:
 *   --flag               boolean flag (returned by [hasFlag])
 *   --key value          value read by [get]
 *   --key=value          value read by [get]
 *   positional args      [positional]
 *
 * Short flags (`-h`) are matched literally by [hasFlag].
 */
internal class OffloadArgs(argv: List<String>, booleanFlags: Set<String> = emptySet()) {
    val positional: List<String>
    private val flags: Set<String>
    private val values: Map<String, String>

    init {
        // T54: every android-* command supports --compact / -q / --quiet for
        // output shaping (see OffloadOutput). Always declare these as boolean
        // flags so e.g. `--compact list` parses as flag + positional rather
        // than `--compact=list` greedy consumption. Recognized at parser level
        // so handlers that haven't been wired through OffloadOutput.formatBody
        // yet still reject the flag's value as a no-op rather than as a
        // missing-positional error.
        val effectiveBooleanFlags = booleanFlags + OffloadOutput.OUTPUT_FLAGS
        val pos = mutableListOf<String>()
        val fs = mutableSetOf<String>()
        val vs = mutableMapOf<String, String>()
        var i = 0
        while (i < argv.size) {
            val a = argv[i]
            when {
                a.startsWith("--") && a.contains('=') -> {
                    val eq = a.indexOf('=')
                    vs[a.substring(2, eq)] = a.substring(eq + 1)
                }
                a.startsWith("--") -> {
                    val key = a.substring(2)
                    val next = argv.getOrNull(i + 1)
                    // A flag is treated as boolean when (a) the caller declared
                    // it as such, or (b) the next token is missing / itself a
                    // flag. Without the declared-boolean set, `--compact foo`
                    // would greedily consume `foo` as the value of `--compact`
                    // and swallow the positional.
                    if (key in effectiveBooleanFlags || next == null || next.startsWith("-")) {
                        fs.add(key)
                    } else {
                        vs[key] = next
                        i++
                    }
                }
                a.startsWith("-") && a.length > 1 -> fs.add(a.substring(1))
                else -> pos.add(a)
            }
            i++
        }
        positional = pos
        flags = fs
        values = vs
    }

    fun hasFlag(vararg names: String): Boolean = names.any { it in flags }
    fun get(vararg names: String): String? = names.firstNotNullOfOrNull { values[it] }
    fun getInt(vararg names: String): Int? = get(*names)?.toIntOrNull()
    fun getLong(vararg names: String): Long? = get(*names)?.toLongOrNull()
    fun getDouble(vararg names: String): Double? = get(*names)?.toDoubleOrNull()
    fun getBool(vararg names: String): Boolean? =
        get(*names)?.lowercase()?.let { it == "true" || it == "1" || it == "yes" }
}
