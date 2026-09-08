package com.openminis.app.tools

import com.openminis.app.browser.BrowserAction
import org.json.JSONArray
import org.json.JSONObject

/**
 * Tool schema definition for browser_use, mirroring the iOS agent tool registration.
 * Used when sending tool definitions to the LLM API.
 */
object BrowserUseTool {

    const val NAME = "browser_use"

    val description = """Control web browser with up to 3 tabs. Actions: navigate to URL, take screenshot, click elements, type text, get page text, scroll, get page info, execute JavaScript, find elements by selector, hover, get readable content, set user agent, get page backbone (DOM structure), fetch resource, manage tabs (new_tab, close_tab, list_tabs).""".trimIndent()

    /**
     * Build the JSON tool definition for the Anthropic / OpenAI / Gemini API.
     * Returns a JSONObject suitable for the "tools" array in the API request.
     */
    fun toolDefinition(): JSONObject {
        val tool = JSONObject()
        tool.put("name", NAME)
        tool.put("description", description)

        val properties = JSONObject()

        properties.put("tool_title", JSONObject().apply {
            put("type", "string")
            put("description", "5-10 word summary of what this call does")
        })

        properties.put("action", JSONObject().apply {
            put("type", "string")
            put("description", "The browser action to perform")
            put("enum", JSONArray(BrowserAction.allValues))
        })

        properties.put("url", JSONObject().apply {
            put("type", "string")
            put("description", "URL to navigate to or fetch (for navigate/fetch/new_tab)")
        })

        properties.put("selector", JSONObject().apply {
            put("type", "string")
            put("description", "CSS selector for element interaction (click/type/hover/find_elements/get_text/scroll)")
        })

        properties.put("text", JSONObject().apply {
            put("type", "string")
            put("description", "Text to type into the selected element")
        })

        properties.put("coordinate_x", JSONObject().apply {
            put("type", "integer")
            put("description", "X coordinate for click-by-position")
        })

        properties.put("coordinate_y", JSONObject().apply {
            put("type", "integer")
            put("description", "Y coordinate for click-by-position")
        })

        properties.put("direction", JSONObject().apply {
            put("type", "string")
            put("description", "Scroll direction")
            put("enum", JSONArray(listOf("up", "down")))
        })

        properties.put("amount", JSONObject().apply {
            put("type", "integer")
            put("description", "Scroll amount in pixels (default 500)")
        })

        properties.put("script", JSONObject().apply {
            put("type", "string")
            put("description", "JavaScript code to execute (for execute_js). The script runs inside an async function wrapper — await and top-level return are both supported.")
        })

        properties.put("user_agent", JSONObject().apply {
            put("type", "string")
            put("description", "User agent profile to switch to")
            put("enum", JSONArray(listOf("desktop_chrome", "mobile_chrome")))
        })

        properties.put("max_depth", JSONObject().apply {
            put("type", "integer")
            put("description", "Maximum DOM tree depth for get_backbone (default 5)")
        })

        properties.put("tab_id", JSONObject().apply {
            put("type", "integer")
            put("description", "Tab ID for tab management actions")
        })

        properties.put("full_page", JSONObject().apply {
            put("type", "boolean")
            put("default", false)
            put("description", "When true on screenshot, capture the entire scrollable page by temporarily stretching the viewport to document.scrollHeight (height-capped at 32768 px). Default false captures only the current viewport.")
        })

        val inputSchema = JSONObject()
        inputSchema.put("type", "object")
        inputSchema.put("properties", properties)
        inputSchema.put("required", JSONArray(listOf("tool_title", "action")))

        tool.put("input_schema", inputSchema)
        return tool
    }

    /**
     * Build tool definition for Anthropic API format.
     */
    fun anthropicToolDefinition(): JSONObject = toolDefinition()

    /**
     * Build tool definition for OpenAI API function calling format.
     */
    fun openAIFunctionDefinition(): JSONObject {
        val def = toolDefinition()
        val fn = JSONObject()
        fn.put("type", "function")
        val function = JSONObject()
        function.put("name", def.getString("name"))
        function.put("description", def.getString("description"))
        function.put("parameters", def.getJSONObject("input_schema"))
        fn.put("function", function)
        return fn
    }
}
