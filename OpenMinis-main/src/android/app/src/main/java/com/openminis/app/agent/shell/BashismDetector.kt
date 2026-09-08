package com.openminis.app.agent.shell

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.util.regex.Pattern

/**
 * Detects busybox-ash-incompatible bash syntax so `shell_execute` can install +
 * switch to bash only when needed (T-bash-on-demand). The rule table and its
 * fix hints are the SHARED JSON (assets/bashism/bashism_rules.json, generated
 * from src/shared/bashism — the same file iOS loads), so the two platforms can
 * never drift.
 *
 * Algorithm (design §1), isomorphic to iOS BashismDetector.swift:
 *   1. strip heredoc BODIES (data, not shell syntax — the F1 false-positive fix),
 *   2. line-by-line regex scan of the remaining shell-layer text,
 *   3. 50ms wall-clock fuse (fail-open) + 4KB per-line cap (M2 ReDoS guard).
 */
object BashismDetector {

    enum class Tier { S, E, T1 }

    data class Rule(
        val name: String,
        val tier: Tier,
        val regex: Pattern,
        val behaviorNote: String,
        val fixHint: String,
    )

    data class Hit(
        val line: Int,
        val ruleName: String,
        val tier: Tier,
        val matchedText: String,
        val behaviorNote: String,
        val fixHint: String,
    )

    data class Result(val hits: List<Hit>) {
        val needsBash: Boolean get() = hits.isNotEmpty()
        val mustSwitchInterpreter: Boolean get() = hits.any { it.tier == Tier.S || it.tier == Tier.E }
        val hasSilent: Boolean get() = hits.any { it.tier == Tier.S }
    }

    private const val TAG = "Bashism"
    private val heredocOpen = Pattern.compile("<<-?\\s*[\"']?(\\w+)[\"']?")

    @Volatile private var rules: List<Rule> = emptyList()
    @Volatile private var loaded = false

    /** Must be called once (e.g. from Application.onCreate) with app context. */
    fun ensureLoaded(context: Context) {
        if (loaded) return
        synchronized(this) {
            if (loaded) return
            rules = try {
                val json = context.assets.open("bashism/bashism_rules.json")
                    .bufferedReader().use { it.readText() }
                parseRules(json)
            } catch (e: Exception) {
                Log.e(TAG, "bashism_rules.json missing or malformed — detector disabled", e)
                emptyList()
            }
            loaded = true
        }
    }

    /** Test seam: load rules directly from a JSON string (JVM unit tests). */
    fun loadRulesForTest(rulesJson: String) {
        rules = parseRules(rulesJson)
        loaded = true
    }

    fun rulesByName(): Map<String, Rule> = rules.associateBy { it.name }

    private fun parseRules(json: String): List<Rule> {
        return try {
            val arr = JSONObject(json).getJSONArray("rules")
            val out = ArrayList<Rule>(arr.length())
            for (i in 0 until arr.length()) {
                val r = arr.getJSONObject(i)
                val tier = when (r.getString("tier")) {
                    "S" -> Tier.S; "E" -> Tier.E; "T1" -> Tier.T1
                    else -> continue
                }
                val pattern = try {
                    Pattern.compile(r.getString("pattern"))
                } catch (e: Exception) {
                    Log.e(TAG, "rule '${r.optString("name")}' has an invalid regex — skipped", e)
                    continue
                }
                out.add(
                    Rule(
                        name = r.getString("name"),
                        tier = tier,
                        regex = pattern,
                        behaviorNote = r.optString("behaviorNote"),
                        fixHint = r.optString("fixHint"),
                    )
                )
            }
            Log.i(TAG, "loaded ${out.size} bashism rules")
            out
        } catch (e: Exception) {
            Log.e(TAG, "bashism_rules.json missing or malformed — detector disabled", e)
            emptyList()
        }
    }

    /**
     * Original line paired with the text to scan; heredoc-body lines (and the
     * delimiter line) map to null so they are skipped while line numbers stay
     * aligned to the original script.
     */
    fun shellLayerLines(script: String): List<Pair<Int, String?>> {
        val lines = script.split("\n")
        val out = ArrayList<Pair<Int, String?>>()
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            out.add((i + 1) to line) // opening line IS shell-layer
            val delims = ArrayList<String>()
            val m = heredocOpen.matcher(line)
            while (m.find()) delims.add(m.group(1)!!)
            i++
            for (delim in delims) {
                while (i < lines.size && lines[i].trim() != delim) {
                    out.add((i + 1) to null) // body line — do not scan
                    i++
                }
                if (i < lines.size) { // delimiter line
                    out.add((i + 1) to null)
                    i++
                }
            }
        }
        return out
    }

    fun detect(script: String, fuseMs: Long = 50): Result {
        if (rules.isEmpty()) return Result(emptyList())
        val start = System.currentTimeMillis()
        val hits = ArrayList<Hit>()
        for ((lineNo, maybeText) in shellLayerLines(script)) {
            val text = maybeText ?: continue
            if (text.isEmpty()) continue
            val scan = if (text.length > 4096) text.substring(0, 4096) else text
            for (rule in rules) {
                if (System.currentTimeMillis() - start > fuseMs) {
                    Log.i(TAG, "scan fuse tripped at ${hits.size} hits — fail-open")
                    return Result(hits)
                }
                if (rule.regex.matcher(scan).find()) {
                    hits.add(
                        Hit(
                            line = lineNo,
                            ruleName = rule.name,
                            tier = rule.tier,
                            matchedText = scan.trim(),
                            behaviorNote = rule.behaviorNote,
                            fixHint = rule.fixHint,
                        )
                    )
                }
            }
        }
        return Result(hits)
    }
}
