# Debug Server API

MinisApp includes a built-in JSON-RPC 2.0 debug server (DEBUG builds only) for runtime view inspection.

## Connection

The server listens on **`http://localhost:8321`** and accepts only **POST** requests with `Content-Type: application/json`.

## Protocol

All requests follow the [JSON-RPC 2.0](https://www.jsonrpc.org/specification) specification:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "<method_name>",
  "params": { ... }
}
```

## Methods

### `debug.viewTree`

Dump the full UIKit view hierarchy starting from all connected windows.

**Params:**

| Name       | Type  | Default | Description                        |
|------------|-------|---------|------------------------------------|
| `maxDepth` | `int` | `50`    | Maximum depth to recurse into subviews |

**Response:**

Returns a tree (or array of trees for multiple windows). Each node:

```json
{
  "type": "UIView",
  "address": "0x1234abcd",
  "frame": { "x": 0, "y": 0, "w": 393, "h": 852 },
  "identifier": "optional_accessibility_id",
  "children": [ ... ]
}
```

**Example:**

```bash
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 1,
  "method": "debug.viewTree",
  "params": { "maxDepth": 3 }
}' | python3 -m json.tool
```

---

### `debug.search`

Search the view hierarchy by type name or accessibility identifier.

**Params:**

| Name      | Type     | Default | Description                                          |
|-----------|----------|---------|------------------------------------------------------|
| `keyword` | `string` | —       | **Required.** Case-insensitive substring to match    |
| `scope`   | `string` | `"all"` | `"type"`, `"identifier"`, or `"all"` (both)          |

**Response:**

Array of matching views:

```json
[
  {
    "type": "UITextField",
    "address": "0xabcd1234",
    "frame": { "x": 12, "y": 700, "w": 369, "h": 44 },
    "identifier": "chatInput"
  }
]
```

**Example:**

```bash
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 2,
  "method": "debug.search",
  "params": { "keyword": "TextField", "scope": "type" }
}' | python3 -m json.tool
```

---

### `debug.inspect`

Get detailed properties of a specific view by its memory address.

**Params:**

| Name      | Type     | Default | Description                                         |
|-----------|----------|---------|-----------------------------------------------------|
| `address` | `string` | —       | **Required.** Hex address from `viewTree` or `search` (e.g. `"0x1234abcd"`) |

**Response:**

```json
{
  "type": "UIView",
  "address": "0x1234abcd",
  "frame": { "x": 0, "y": 0, "w": 393, "h": 852 },
  "bounds": { "x": 0, "y": 0, "w": 393, "h": 852 },
  "intrinsicContentSize": { "w": -1, "h": -1 },
  "isHidden": false,
  "alpha": 1.0,
  "clipsToBounds": false,
  "childCount": 3,
  "backgroundColor": "rgba(255,255,255,1.00)",
  "identifier": "optional_id",
  "superviewType": "UIWindow",
  "constraints": [
    {
      "id": "0xdeadbeef",
      "constant": 0,
      "priority": 1000,
      "description": "NSLayoutConstraint ..."
    }
  ]
}
```

**Example:**

```bash
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 3,
  "method": "debug.inspect",
  "params": { "address": "0x1234abcd" }
}' | python3 -m json.tool
```

---

### `debug.highlight`

Temporarily highlight a view with a colored border for visual identification on device.

**Params:**

| Name       | Type     | Default | Description                                                     |
|------------|----------|---------|-----------------------------------------------------------------|
| `address`  | `string` | —       | **Required.** Hex address of the view to highlight              |
| `color`    | `string` | `"red"` | Border color: `red`, `green`, `blue`, `yellow`, `orange`, `purple`, `cyan` |
| `duration` | `number` | `2.0`   | Seconds to keep the highlight visible                           |

**Response:**

```json
{ "ok": true }
```

Returns `{ "ok": false }` if the view was not found.

**Example:**

```bash
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 4,
  "method": "debug.highlight",
  "params": { "address": "0x1234abcd", "color": "blue", "duration": 3 }
}' | python3 -m json.tool
```

---

### `debug.agentTrace`

Get agent request traces for debugging AI agent interactions.

**Params:**

| Name   | Type   | Default | Description                              |
|--------|--------|---------|------------------------------------------|
| `last` | `bool` | `false` | If `true`, return only the most recent trace |

**Response:**

When `last` is `false` (default):

```json
{ "traces": [ ... ] }
```

When `last` is `true`, returns the single most recent trace object, or `{ "traces": [] }` if none.

**Example:**

```bash
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 5,
  "method": "debug.agentTrace",
  "params": { "last": true }
}' | python3 -m json.tool
```

---

### `debug.ls`

List directory contents in the app's filesystem.

**Params:**

| Name        | Type     | Default | Description                                          |
|-------------|----------|---------|------------------------------------------------------|
| `path`      | `string` | `"/"`   | Path to list. Prefix with `Library/` or `Documents/` for those directories; otherwise resolves relative to the rootfs data path |
| `recursive` | `bool`   | `false` | If `true`, recurse into subdirectories               |
| `maxDepth`  | `int`    | `3`     | Maximum recursion depth (only used when `recursive` is `true`) |

**Response:**

Array of entries:

```json
[
  { "name": "var", "type": "directory" },
  { "name": "config.json", "type": "file", "size": 1234, "modified": "2025-01-01T00:00:00Z" }
]
```

When `recursive` is `true`, directory entries include a `children` array.

**Example:**

```bash
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 6,
  "method": "debug.ls",
  "params": { "path": "/var/minis", "recursive": true, "maxDepth": 2 }
}' | python3 -m json.tool
```

---

### `debug.readFile`

Read a file from the app's filesystem.

**Params:**

| Name     | Type     | Default | Description                                            |
|----------|----------|---------|--------------------------------------------------------|
| `path`   | `string` | —       | **Required.** File path (same prefix rules as `debug.ls`) |
| `base64` | `bool`   | `false` | Force base64 encoding even for text files              |
| `offset` | `int`    | —       | Byte offset to start reading from                      |
| `limit`  | `int`    | —       | Maximum bytes to read                                  |

**Response:**

```json
{
  "size": 4096,
  "content": "file contents here...",
  "encoding": "utf8"
}
```

Binary files (or when `base64` is `true`) return `"encoding": "base64"` with base64-encoded content. Files larger than 500MB require `offset`/`limit` for partial reads.

**Example:**

```bash
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 7,
  "method": "debug.readFile",
  "params": { "path": "/etc/hostname" }
}' | python3 -m json.tool
```

---

### `debug.appInfo`

Get app paths and disk usage information.

**Params:** None.

**Response:**

```json
{
  "documentsPath": "/path/to/Documents",
  "libraryPath": "/path/to/Library",
  "dataPath": "/path/to/alpine-rootfs/data",
  "rootfsPath": "/path/to/Documents/alpine-rootfs",
  "bundlePath": "/path/to/Minis.app",
  "diskUsage": {
    "documents": 12345678,
    "rootfsData": 87654321,
    "bundle": 45678901
  }
}
```

**Example:**

```bash
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 8,
  "method": "debug.appInfo",
  "params": {}
}' | python3 -m json.tool
```

---

### `debug.screenshot`

Capture a PNG screenshot of the entire app screen.

**Params:**

| Name     | Type     | Default | Description                                      |
|----------|----------|---------|--------------------------------------------------|
| `scale`  | `number` | `1.0`   | Render scale (e.g. `2.0` for Retina resolution)  |
| `window` | `int`    | `0`     | Window index (0 = main window)                   |

**Response:**

```json
{
  "base64": "<base64-encoded PNG data>",
  "size": 234567,
  "encoding": "png"
}
```

**Example:**

```bash
# Capture and save screenshot
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 1,
  "method": "debug.screenshot",
  "params": { "scale": 2 }
}' | python3 -c "
import json, sys, base64
r = json.load(sys.stdin)
with open('app_screenshot.png', 'wb') as f:
    f.write(base64.b64decode(r['result']['base64']))
print('Saved app_screenshot.png')
"
```

---

### `debug.llmRequests`

Get recent LLM API request data (same data as the "Copy Requests" menu in session toolbar).

**Params:**

| Name        | Type   | Default | Description                                        |
|-------------|--------|---------|----------------------------------------------------|
| `last`      | `int`  | —       | Return only the last N requests                    |
| `formatted` | `bool` | `false` | If `true`, return pre-formatted text instead of structured JSON |

**Response (default):**

Each entry contains the full request/response round-trip data:

```json
{
  "count": 3,
  "requests": [
    {
      "provider": "Anthropic",
      "timestamp": "2026-03-07T14:30:05.123Z",
      "requestMethod": "POST",
      "requestURL": "https://api.anthropic.com/v1/messages",
      "requestHeaders": { "content-type": "application/json", "anthropic-version": "2023-06-01" },
      "requestBody": "{...}",
      "durationMs": 1250,
      "usage": {
        "inputTokens": 512,
        "outputTokens": 128,
        "cacheCreationTokens": 0,
        "cacheReadTokens": 256
      },
      "responseStatusCode": 200,
      "responseHeaders": { "content-type": "text/event-stream", "request-id": "req_..." },
      "responseBody": "event: message_start\ndata: {...}\n\nevent: content_block_delta\n..."
    }
  ]
}
```

Notes:
- `requestHeaders` excludes `Authorization` and `x-api-key` for security
- `responseBody` contains accumulated SSE chunks, capped at 64KB
- `responseHeaders` and `responseBody` are only present for Anthropic requests (captured at URLProtocol level)

**Response (formatted):**

```json
{
  "count": 3,
  "text": "// --- #1 Anthropic 14:30:05 1250ms HTTP 200 | in:512 out:128 cache_read:256 ---\n// POST https://api.anthropic.com/v1/messages\n{...}\n// --- Response (12345 chars) ---\nevent: message_start\n..."
}
```

**Examples:**

```bash
# Get all recent LLM requests
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 9,
  "method": "debug.llmRequests",
  "params": {}
}' | python3 -m json.tool

# Get only the last 2 requests
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 10,
  "method": "debug.llmRequests",
  "params": { "last": 2 }
}' | python3 -m json.tool

# Get formatted text (same as Copy Requests clipboard output)
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 11,
  "method": "debug.llmRequests",
  "params": { "formatted": true }
}' | python3 -m json.tool
```

---

## Provider Management Methods

These methods cover the "Settings → AI Providers" surface: creating/removing provider instances, testing credentials, editing the model list, and pushing user overrides. They drive the same underlying `ProviderConfigStore`, `ProviderKeychainHelper`, and model-refresh pipeline the UI uses — so an RPC-created instance shows up in the UI exactly like a user-added one, and vice versa.

### Implementation scope note

Per project convention, the RPC handlers are **thin wrappers** over a provider-mutation facade (tentatively `ProviderMutations`) that lives outside the debug server target. The facade is the only code that touches `ProviderConfigStore` / `ProviderKeychainHelper` / `OpenAIModelsAPI`-style fetchers. The debug server calls into that facade, but so can future consumers — e.g. a headless agent CLI that configures providers from a YAML file, or a fleet-management tool that pushes credentials over MDM. All methods below are designed so the JSON-RPC shape maps 1:1 to the facade's public API (same field names, same error codes) — the debug server adds no semantic value beyond transport and authz.

Shared conventions:

- **Provider types** are the enum in `ProviderTypes.swift`: `openAI`, `anthropic`, `gemini`, `antigravity`, `openRouter`, `openAIResponses`. Use `provider.types` to discover at runtime what each type accepts (field schema, credential options, OAuth support).
- **Credential material** (API keys, OAuth tokens) is **write-only** — never returned by any list/get method. `provider.instances.create` and `provider.instances.update` accept it; everything else treats it as opaque. This matches how the UI handles credentials: you can overwrite, never reveal.
- **Instance IDs** are stable UUIDs. **Model entry IDs** are the UUIDs surfaced by `chat.models.list` and the in-app picker. Everything IDs stays consistent across surfaces.
- **Persistence side effects**: every mutation writes through `ProviderConfigStore` (which persists to `config.json` and triggers iCloud sync) in the same transaction as the Keychain write, so a failed Keychain write rolls back the instance add — no orphaned entries.

### `provider.types`

Return the schema of every supported provider type, including which fields `provider.instances.create` accepts, whether OAuth is available, default base URLs, and built-in model IDs.

**Params:** None.

**Response:**

```json
{
  "types": [
    {
      "id": "openAI",
      "displayName": "OpenAI",
      "supportedCredentials": ["apiKey", "oauth"],
      "oauthFlow": "codex",
      "defaultBaseURL": "https://api.openai.com",
      "customBaseURLSupported": true,
      "appendV1SuffixConfigurable": true,
      "defaultModality": "vision",
      "requiredFields": ["label"],
      "acceptedFields": [
        { "name": "label", "type": "string", "required": true, "description": "User-visible name" },
        { "name": "credentialType", "type": "enum", "values": ["apiKey", "oauth"], "default": "apiKey" },
        { "name": "apiKey", "type": "string", "writeOnly": true, "requiredWhen": "credentialType=apiKey" },
        { "name": "customBaseURL", "type": "string", "optional": true, "example": "https://api.deepseek.com" },
        { "name": "appendV1Suffix", "type": "bool", "default": true },
        { "name": "isEnabled", "type": "bool", "default": true }
      ],
      "builtInModelIds": ["gpt-5", "gpt-5-mini", "o3-mini", "chatgpt-4o"]
    },
    {
      "id": "anthropic",
      "displayName": "Anthropic",
      "supportedCredentials": ["apiKey", "oauth"],
      "oauthFlow": "claude",
      "defaultBaseURL": "https://api.anthropic.com",
      "customBaseURLSupported": false,
      "defaultModality": "vision",
      "requiredFields": ["label"],
      "acceptedFields": [ "…" ],
      "builtInModelIds": ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"]
    }
  ]
}
```

Callers should drive the rest of the provider flow from this schema rather than hard-coding — so when a new provider type is added to the app, existing automation keeps working without changes.

---

### `provider.instances.list`

List all configured provider instances.

**Params:**

| Name              | Type   | Default | Description                                                             |
|-------------------|--------|---------|-------------------------------------------------------------------------|
| `includeDisabled` | `bool` | `true`  | If `false`, omit instances where `isEnabled=false`.                     |

**Response:**

```json
{
  "count": 2,
  "instances": [
    {
      "id": "pi_abc",
      "label": "OpenAI",
      "providerType": "openAI",
      "credentialType": "apiKey",
      "isEnabled": true,
      "customBaseURL": null,
      "appendV1Suffix": true,
      "createdAt": "2026-03-11T04:00:00Z",
      "hasCredential": true,
      "modelEntryCount": 18
    }
  ]
}
```

`hasCredential` indicates the Keychain has a non-empty secret stored for this instance. The secret itself is never returned.

---

### `provider.instances.create`

Add a new provider instance. Required fields vary by `providerType` — consult `provider.types` for the accepted-field schema.

**Params (common):**

| Name              | Type     | Default | Description                                                                 |
|-------------------|----------|---------|-----------------------------------------------------------------------------|
| `providerType`    | `string` | —       | **Required.** One of the types from `provider.types`.                       |
| `label`           | `string` | —       | **Required.** User-visible name (e.g. `"DeepSeek Prod"`).                   |
| `credentialType`  | `string` | `"apiKey"` | `"apiKey"` or `"oauth"`. Must be listed in the type's `supportedCredentials`. |
| `apiKey`          | `string` | `null`  | Required when `credentialType=apiKey`. Write-only; stored in Keychain.      |
| `oauthToken`      | `string` | `null`  | Used to seed a manual OAuth token (for types that support it).              |
| `customBaseURL`   | `string` | `null`  | Optional; only honored when the type sets `customBaseURLSupported=true`.    |
| `appendV1Suffix`  | `bool`   | `true`  | Only meaningful when `customBaseURL` is set.                                |
| `isEnabled`       | `bool`   | `true`  | Create in enabled state.                                                    |
| `seedBuiltInModels` | `bool` | `true`  | If `true`, populate the instance with the type's built-in model entries. Set to `false` for custom-base endpoints where the built-in IDs don't match. |

**Response:**

```json
{
  "instance": {
    "id": "pi_xyz",
    "label": "DeepSeek Prod",
    "providerType": "openAI",
    "credentialType": "apiKey",
    "customBaseURL": "https://api.deepseek.com",
    "appendV1Suffix": true,
    "isEnabled": true,
    "hasCredential": true,
    "createdAt": "2026-04-24T08:00:00Z",
    "modelEntryCount": 0
  }
}
```

**Errors:**

| Code     | Condition                                                     |
|----------|---------------------------------------------------------------|
| `-32602` | Unknown `providerType`, or required field missing/invalid.    |
| `-32602` | `credentialType` not in the type's `supportedCredentials`.    |
| `-32602` | `customBaseURL` supplied for a type that doesn't allow it.    |
| `-32000` | Keychain write failed — instance was not created.             |

**Example — add a DeepSeek custom-base OpenAI-compatible instance:**

```bash
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 1,
  "method": "provider.instances.create",
  "params": {
    "providerType": "openAI",
    "label": "DeepSeek Prod",
    "apiKey": "sk-deepseek-…",
    "customBaseURL": "https://api.deepseek.com",
    "seedBuiltInModels": false
  }
}' | python3 -m json.tool
```

---

### `provider.instances.update`

Mutate fields on an existing instance. Only provided fields are updated; omitted fields are left alone. Write-only credential fields (`apiKey`, `oauthToken`) overwrite the stored secret when supplied.

**Params:**

| Name             | Type     | Default | Description                                             |
|------------------|----------|---------|---------------------------------------------------------|
| `instanceId`     | `string` | —       | **Required.** Target instance.                          |
| `label`          | `string` | —       | New display name.                                       |
| `apiKey`         | `string` | —       | Replace stored API key. Pass `""` to explicitly clear. |
| `oauthToken`     | `string` | —       | Replace stored manual OAuth token.                      |
| `customBaseURL`  | `string` | —       | Change base URL. Pass `null` to revert to default.      |
| `appendV1Suffix` | `bool`   | —       | Update suffix behavior.                                 |
| `isEnabled`      | `bool`   | —       | Enable or disable.                                      |

**Response:** Same shape as `provider.instances.create`.

---

### `provider.instances.delete`

Remove a provider instance and all its model entries. Clears Keychain entries and any session bindings that point at it.

**Params:**

| Name         | Type     | Default | Description                                                                       |
|--------------|----------|---------|-----------------------------------------------------------------------------------|
| `instanceId` | `string` | —       | **Required.**                                                                     |
| `confirm`    | `bool`   | `false` | Must be `true`. Returns `-32602` if omitted — guards against automation mistakes. |

**Response:**

```json
{
  "instanceId": "pi_xyz",
  "deletedModelEntries": 14,
  "affectedSessionBindings": 3
}
```

`affectedSessionBindings` counts sessions whose primary binding was invalidated by the delete (they fall back to the default group on next use, same as the UI).

---

### `provider.instances.test`

Issue a minimal request to the provider using the stored credential to verify reachability. For OpenAI-shape instances this calls `/v1/models` (the same probe the model refresh uses); for OAuth instances it attempts a token validation.

**Params:**

| Name         | Type     | Default | Description                                  |
|--------------|----------|---------|----------------------------------------------|
| `instanceId` | `string` | —       | **Required.**                                |
| `timeoutMs`  | `int`    | `10000` | Clamped to `[1000, 30000]`.                  |

**Response:**

```json
{
  "ok": true,
  "httpStatus": 200,
  "latencyMs": 312,
  "reachableModelCount": 47,
  "error": null
}
```

On failure: `ok=false`, `httpStatus` (if applicable), and `error.code` / `error.message` (e.g. `"invalid_api_key"`, `"network_timeout"`).

---

### `provider.models.list`

List model entries for a specific provider instance. This is the per-instance view; `chat.models.list` returns the picker-flattened view across all instances.

**Params:**

| Name            | Type   | Default | Description                                   |
|-----------------|--------|---------|-----------------------------------------------|
| `instanceId`    | `string` | —     | **Required.**                                 |
| `includeHidden` | `bool` | `false` | Include entries the user hid from the picker. |

**Response:**

```json
{
  "instanceId": "pi_xyz",
  "count": 3,
  "entries": [
    {
      "id": "entry_123",
      "modelId": "deepseek-v4-flash",
      "displayName": "DeepSeek V4 Flash",
      "baseModelDisplayName": "DeepSeek V4 Flash",
      "isCustom": false,
      "isHidden": false,
      "supportsReasoning": null,
      "contextWindow": 1000000,
      "maxOutputTokens": 384000,
      "overrides": { "displayName": null, "maxOutputTokens": null },
      "userModifiedAt": null
    }
  ]
}
```

`overrides` reflects `ModelOverrides` — the user-edit layer that survives API refreshes. `baseModelDisplayName` exposes the pre-override name so callers can tell whether the user renamed a model.

---

### `provider.models.add`

Add a custom model entry to an instance. Equivalent to "Add Custom Model" in the UI.

**Params:**

| Name                   | Type     | Default | Description                                                          |
|------------------------|----------|---------|----------------------------------------------------------------------|
| `instanceId`           | `string` | —       | **Required.**                                                        |
| `modelId`              | `string` | —       | **Required.** API model ID (e.g. `"deepseek-v4-pro"`).               |
| `displayName`          | `string` | `null`  | Defaults to a prettified `modelId` when omitted.                     |
| `contextWindow`        | `int`    | `null`  | Tokens.                                                              |
| `maxOutputTokens`      | `int`    | `null`  | Tokens.                                                              |
| `supportsReasoning`    | `bool`   | `null`  | Tri-state: `true`/`false`/`null` (unknown — toggle stays available). |
| `supportsImageInput`   | `bool`   | `null`  | Modality flag.                                                       |
| `supportsAudioInput`   | `bool`   | `null`  | Modality flag.                                                       |
| `supportsVideoInput`   | `bool`   | `null`  | Modality flag.                                                       |
| `supportsPDFInput`     | `bool`   | `null`  | Modality flag.                                                       |
| `supportsImageOutput`  | `bool`   | `null`  | Modality flag.                                                       |

**Response:** Same shape as one `entries[]` item in `provider.models.list`, with `isCustom=true`.

---

### `provider.models.update`

Patch a model entry — either a custom entry or a built-in entry's user overrides. Omitted fields are untouched; pass `null` explicitly to clear a field.

**Params:**

| Name              | Type     | Default | Description                                                            |
|-------------------|----------|---------|------------------------------------------------------------------------|
| `entryId`         | `string` | —       | **Required.**                                                          |
| `displayName`     | `string` | —       | Overrides the visible name. `null` clears the override.                |
| `maxOutputTokens` | `int`    | —       | Overrides the model's output limit. `null` clears the override.        |
| `isHidden`        | `bool`   | —       | Toggle picker visibility.                                              |
| `modelId`         | `string` | —       | **Custom entries only.** Rename the backing API model ID.              |

Attempting to change `modelId` on a non-custom entry returns `-32602` (`"built-in model ID is immutable"`).

**Response:** Updated entry in the `provider.models.list` shape.

---

### `provider.models.delete`

Remove a custom model entry. Built-in entries cannot be deleted — hide them with `provider.models.update` `isHidden=true` instead (returns `-32602` if called on a non-custom entry).

**Params:**

| Name      | Type     | Default | Description                                                                     |
|-----------|----------|---------|---------------------------------------------------------------------------------|
| `entryId` | `string` | —       | **Required.**                                                                   |
| `confirm` | `bool`   | `false` | Must be `true`. Guards against automation mistakes.                             |

**Response:**

```json
{ "entryId": "entry_123", "deleted": true, "affectedSessionBindings": 0 }
```

---

### `provider.models.refresh`

Trigger a model-list refresh for an instance (re-queries `/v1/models` or the equivalent for the provider type). User overrides are preserved; new entries appear, gone entries are hidden (not deleted — same behavior as the UI's refresh button).

**Params:**

| Name         | Type     | Default | Description     |
|--------------|----------|---------|-----------------|
| `instanceId` | `string` | —       | **Required.**   |

**Response:**

```json
{
  "instanceId": "pi_xyz",
  "added": 3,
  "updated": 12,
  "disappeared": 1,
  "total": 18,
  "durationMs": 412
}
```

`disappeared` entries are kept in the store (hidden) so sessions that still reference them by ID keep working.

---

### `provider.models.setAgentLoop`

Toggle whether a specific model entry is exposed to the in-shell `minis-model-use` agent. Equivalent to the "Available in Agent Loop" toggle in the model entry detail screen — agent-loop visibility is what determines if the in-shell tool can list and invoke a model.

**Params:**

| Name      | Type     | Default | Description                                                  |
|-----------|----------|---------|--------------------------------------------------------------|
| `entryId` | `string` | —       | **Required.** Target entry UUID.                             |
| `inLoop`  | `bool`   | —       | **Required.** `true` to add to agent loop, `false` to remove. |

**Response:**

```json
{ "entryId": "entry_123", "inLoop": true }
```

`inLoop` in the response reflects the post-mutation state — useful for confirming idempotent calls.

---

## Model Group Management Methods

Model groups bundle multiple model entries under a single picker option, with a routing strategy (`fallback` or `loadBalance`). The default group is what new sessions bind to when the user hasn't pinned a specific model. These methods cover the "Settings → Model Groups" surface.

Shared conventions:

- **Group IDs** are stable UUIDs surfaced in `chat.models.list.groups[].id`.
- **Member entry IDs** are model entry UUIDs (from `chat.models.list.entries[].id` or `provider.models.list`). The group resolves them at chat time; if a member entry is later deleted, the group skips it.
- **Default-group state** is global, not per-instance: there is one `defaultPrimaryGroupId` per app install. Use `chat.models.list.defaultGroupId` to read it; mutate via `provider.groups.setDefault`.

### `provider.groups.list`

List all configured model groups with their members and routing strategies.

**Params:**

| Name             | Type   | Default | Description                                                   |
|------------------|--------|---------|---------------------------------------------------------------|
| `includeMembers` | `bool` | `true`  | Include `members[]` (resolved entry summaries) in each group. |

**Response:**

```json
{
  "defaultGroupId": "grp_default",
  "count": 2,
  "groups": [
    {
      "id": "grp_default",
      "name": "Default",
      "strategy": "fallback",
      "fallbackStrategy": "limited",
      "memberEntryIds": ["entry_a", "entry_b"],
      "isDefault": true,
      "inAgentLoop": true,
      "defaultThinkingLevel": "medium",
      "contextLimitTokens": null,
      "members": [
        { "entryId": "entry_a", "modelId": "deepseek-v4-flash", "displayName": "DeepSeek V4 Flash", "providerLabel": "DeepSeek" }
      ]
    }
  ]
}
```

`members[]` is resolved live against the entry list — entries that no longer exist are omitted (without disturbing `memberEntryIds`).

---

### `provider.groups.create`

Create a new model group.

**Params:**

| Name                   | Type       | Default        | Description                                                                                              |
|------------------------|------------|----------------|----------------------------------------------------------------------------------------------------------|
| `name`                 | `string`   | —              | **Required.** Display name (must be non-empty).                                                          |
| `memberEntryIds`       | `[string]` | `[]`           | Initial member entries. Order is significant for `fallback` strategy.                                    |
| `strategy`             | `string`   | `"fallback"`   | `"fallback"` or `"loadBalance"`.                                                                         |
| `fallbackStrategy`     | `string`   | `"limited"`    | When `strategy=fallback`: `"limited"` (default — fallback only on provider errors) or `"always"` (any error). |
| `defaultThinkingLevel` | `string`   | `null`         | Applied to new sessions bound to this group. `"off"` / `"low"` / `"medium"` / `"high"` / `"xhigh"`.       |
| `contextLimitTokens`   | `int`      | `null`         | Override the model's native context limit for sessions bound to this group. `null` = use model native.   |

**Response:**

```json
{ "group": { "id": "grp_new", "name": "Coding", "strategy": "fallback", "memberEntryIds": ["entry_a"], ... } }
```

Same shape as one entry in `provider.groups.list`. Unknown `memberEntryIds` are silently dropped — check the response to confirm what was kept.

---

### `provider.groups.update`

Patch fields on an existing group. Omitted fields are untouched.

**Params:**

| Name                   | Type       | Default | Description                                                                                |
|------------------------|------------|---------|--------------------------------------------------------------------------------------------|
| `groupId`              | `string`   | —       | **Required.** Target group UUID.                                                           |
| `name`                 | `string`   | —       | New display name. Must be non-empty if supplied.                                           |
| `memberEntryIds`       | `[string]` | —       | Replace members entirely. Order is preserved. Pass `[]` to clear all members.              |
| `strategy`             | `string`   | —       | `"fallback"` or `"loadBalance"`.                                                           |
| `fallbackStrategy`     | `string`   | —       | `"limited"` or `"always"`.                                                                 |
| `defaultThinkingLevel` | `string`   | —       | Set thinking-level default. Pass `null` to clear.                                          |
| `contextLimitTokens`   | `int`      | —       | Set context override. Pass `null` to revert to native model limit.                         |

**Response:** Same shape as `provider.groups.create` — the updated group.

---

### `provider.groups.delete`

Remove a group. Sessions bound to it fall back to the default group on next use; the global default-group setting is cleared if the deleted group was the default.

**Params:**

| Name      | Type     | Default | Description                                                          |
|-----------|----------|---------|----------------------------------------------------------------------|
| `groupId` | `string` | —       | **Required.**                                                        |
| `confirm` | `bool`   | `false` | Must be `true` — guards against accidental deletion.                 |

**Response:**

```json
{ "groupId": "grp_xyz", "deleted": true, "wasDefault": false, "affectedSessionBindings": 4 }
```

`affectedSessionBindings` counts sessions whose `primarySource` was a `.group` reference to the deleted group.

---

### `provider.groups.setDefault`

Set or clear the global default model group. The default is what new sessions bind to when no explicit `modelEntryId` / `modelGroupId` is supplied to `chat.prompt`.

**Params:**

| Name      | Type     | Default | Description                                          |
|-----------|----------|---------|------------------------------------------------------|
| `groupId` | `string` | —       | **Required.** Pass `null` to clear the default.      |

**Response:**

```json
{ "defaultGroupId": "grp_xyz" }
```

Returns `-32602` if `groupId` is non-null but doesn't exist.

---

### `provider.groups.setAgentLoop`

Toggle whether a model group is exposed to the in-shell `minis-model-use` agent (parallel to `provider.models.setAgentLoop` but for groups).

**Params:**

| Name      | Type     | Default | Description                                       |
|-----------|----------|---------|---------------------------------------------------|
| `groupId` | `string` | —       | **Required.**                                     |
| `inLoop`  | `bool`   | —       | **Required.** `true` to add, `false` to remove.   |

**Response:**

```json
{ "groupId": "grp_xyz", "inLoop": true }
```

---

## Chat Automation Methods

These methods drive the same chat flows the iOS Shortcuts intents expose (`SendPromptIntent`, `RetryRunIntent`, `GetSessionStatusIntent`, `ListSessionsIntent`, `FollowUpSessionIntent`), wired for remote automation over JSON-RPC.

Shared conventions:

- **Attachments** are passed as an array of `{name, data, mime?}` objects, where `data` is base64-encoded bytes. `name` should include a file extension (e.g. `"photo.jpg"`) — the server uses the extension to infer MIME when `mime` is omitted, matching the iOS `IntentFile` filename-resolution path. Supported categories: images, videos, arbitrary files (same UTTypes as the Shortcuts intent: `public.image`, `public.movie`, `public.data`).
- **Async vs sync**: every send/retry method accepts a `wait` boolean. `wait=false` (default) returns immediately with `status: "Running"` and lets the agent run in the background; `wait=true` blocks until `isProcessing` flips to false and returns the full response text.
- **Session IDs** are the same opaque strings used by `ChatStore` and the Shortcuts intents. Resolve from `chat.sessions.list` or from the `sessionId` returned by `chat.prompt`.
- **Model selection**: `chat.prompt` and `chat.retry` accept either `modelEntryId` (a specific model entry — e.g. a concrete `deepseek-v4-flash` on a particular provider instance) or `modelGroupId` (a model group — the app resolves the member via the group's routing strategy). If both are omitted, the session's existing binding is used; for a brand-new session without a user-set default, the global default group is used (same as tapping "Send" in the UI). Discover valid IDs via `chat.models.list`.

### `chat.sessions.list`

List recent chat sessions with metadata (same source as the Shortcuts "List Sessions" action).

**Params:**

| Name           | Type     | Default | Description                                                             |
|----------------|----------|---------|-------------------------------------------------------------------------|
| `limit`        | `int`    | `50`    | Maximum sessions to return (most recently updated first). Clamped to `[1, 500]`. |
| `includeEmpty` | `bool`   | `false` | If `true`, include sessions with no user messages.                      |

**Response:**

```json
{
  "count": 2,
  "sessions": [
    {
      "id": "6D0F…",
      "title": "Draft a release note",
      "modelId": "deepseek-v4-flash",
      "modelName": "DeepSeek V4 Flash",
      "source": "shortcut",
      "isRunning": false,
      "messageCount": 14,
      "lastMessagePreview": "Shipping notes saved to /tmp/release.md",
      "createdAt": "2026-04-23T09:12:04.110Z",
      "updatedAt": "2026-04-24T05:18:51.827Z"
    }
  ]
}
```

**Example:**

```bash
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 1,
  "method": "chat.sessions.list",
  "params": { "limit": 20 }
}' | python3 -m json.tool
```

---

### `chat.sessions.get`

Fetch one session's metadata and conversation outline. For the full message bodies, use `chat.messages.list`.

**Params:**

| Name        | Type     | Default | Description                          |
|-------------|----------|---------|--------------------------------------|
| `sessionId` | `string` | —       | **Required.** Target session ID.     |

**Response:**

```json
{
  "id": "6D0F…",
  "title": "Draft a release note",
  "modelId": "deepseek-v4-flash",
  "modelName": "DeepSeek V4 Flash",
  "source": "shortcut",
  "isRunning": false,
  "messageCount": 14,
  "createdAt": "2026-04-23T09:12:04.110Z",
  "updatedAt": "2026-04-24T05:18:51.827Z",
  "thinkingLevel": "medium",
  "memoryEnabled": true
}
```

Returns `{ "error": { "code": -32602, "message": "Session not found" } }` if the ID doesn't exist.

---

### `chat.messages.list`

List messages in a session in chronological order. Mirrors what the session UI renders, with assistant blocks flattened into a compact shape.

**Params:**

| Name         | Type     | Default     | Description                                                          |
|--------------|----------|-------------|----------------------------------------------------------------------|
| `sessionId`  | `string` | —           | **Required.**                                                        |
| `limit`      | `int`    | `200`       | Max messages. Clamped to `[1, 1000]`.                                |
| `offset`     | `int`    | `0`         | Skip N messages from the start.                                      |
| `roles`      | `[string]` | all       | Filter by role: `"user"`, `"assistant"`, `"system"`, `"tool"`. Omit for all. |
| `includeTools` | `bool` | `true`      | Include tool-call blocks on assistant messages.                      |
| `includeReasoning` | `bool` | `false` | Include captured `reasoning_content` on assistant messages.          |

**Response:**

```json
{
  "sessionId": "6D0F…",
  "count": 2,
  "messages": [
    {
      "id": "msg_abc",
      "role": "user",
      "createdAt": "2026-04-24T05:18:50.102Z",
      "content": "Summarize the release notes.",
      "attachments": [
        { "name": "notes.md", "size": 4096, "mime": "text/markdown" }
      ]
    },
    {
      "id": "msg_def",
      "role": "assistant",
      "createdAt": "2026-04-24T05:18:51.827Z",
      "content": "Here's a concise summary…",
      "toolCalls": [
        { "id": "tool_1", "name": "shell_execute", "input": { "command": "head notes.md" }, "status": "ok" }
      ],
      "tokenUsage": { "inputTokens": 512, "outputTokens": 128, "cacheReadTokens": 256 },
      "reasoningContent": null
    }
  ]
}
```

**Example:**

```bash
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 2,
  "method": "chat.messages.list",
  "params": { "sessionId": "6D0F…", "limit": 50, "includeReasoning": true }
}' | python3 -m json.tool
```

---

### `chat.sessions.usage`

Return aggregate token usage for a session, broken down per assistant turn. Useful for cost tracking and regression checks.

**Params:**

| Name        | Type     | Default | Description                                  |
|-------------|----------|---------|----------------------------------------------|
| `sessionId` | `string` | —       | **Required.**                                |
| `perTurn`   | `bool`   | `false` | If `true`, include a `turns` array breakdown. |

**Response:**

```json
{
  "sessionId": "6D0F…",
  "totals": {
    "inputTokens": 14821,
    "outputTokens": 3120,
    "cacheCreationTokens": 2048,
    "cacheReadTokens": 9214,
    "reasoningTokens": 640,
    "turnCount": 6
  },
  "turns": [
    {
      "messageId": "msg_def",
      "model": "deepseek-v4-flash",
      "createdAt": "2026-04-24T05:18:51.827Z",
      "inputTokens": 3120,
      "outputTokens": 512,
      "cacheReadTokens": 2800
    }
  ]
}
```

`turns` is omitted when `perTurn=false`. `cacheReadTokens` covers both the OpenAI-native `prompt_tokens_details.cached_tokens` and DeepSeek's `prompt_cache_hit_tokens` (same fallback as the provider).

---

### `chat.models.list`

Return the candidate models and groups the user has configured — i.e. the same set the in-app model picker shows. Use the returned `id`s with `chat.prompt` / `chat.retry` to pin a specific model or group for that call.

**Params:**

| Name              | Type   | Default | Description                                                                 |
|-------------------|--------|---------|-----------------------------------------------------------------------------|
| `includeHidden`   | `bool` | `false` | Include entries the user has hidden from the picker.                        |
| `includeDisabled` | `bool` | `false` | Include entries belonging to disabled provider instances.                   |

**Response:**

```json
{
  "defaultGroupId": "grp_default",
  "groupCount": 3,
  "entryCount": 12,
  "groups": [
    {
      "id": "grp_default",
      "name": "Default",
      "strategy": "roundRobin",
      "isDefault": true,
      "memberEntryIds": ["entry_a", "entry_b"],
      "defaultThinkingLevel": "medium"
    }
  ],
  "entries": [
    {
      "id": "entry_a",
      "modelId": "deepseek-v4-flash",
      "modelName": "DeepSeek V4 Flash",
      "providerInstanceId": "pi_deepseek",
      "providerInstanceName": "DeepSeek",
      "providerType": "openAI",
      "supportsReasoning": null,
      "supportsImages": false,
      "contextWindow": 1000000,
      "maxOutputTokens": 384000,
      "hidden": false
    }
  ]
}
```

Field notes:

- `supportsReasoning` is tri-state: `true` / `false` / `null` (unknown — e.g. models fetched from `/v1/models` with no capability metadata). Match the toggle-availability rule the UI uses.
- `defaultGroupId` is the group used when a new session is created without an explicit binding. `null` if no default group exists.
- `providerType` values match `ProviderType` (`openAI`, `anthropic`, `gemini`, `openRouter`, `openAIResponses`, `antigravity`).

**Example — pick the first reasoning-capable entry and send to it:**

```bash
entry_id=$(curl -s http://localhost:8321 -d '{
  "jsonrpc":"2.0","id":1,"method":"chat.models.list","params":{}
}' | python3 -c "
import json,sys
r=json.load(sys.stdin)['result']
for e in r['entries']:
    if e['supportsReasoning'] is True:
        print(e['id']); break
")

curl -s http://localhost:8321 -d "{
  \"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"chat.prompt\",
  \"params\":{\"prompt\":\"Explain the halting problem.\",\"modelEntryId\":\"$entry_id\",\"wait\":true}
}" | python3 -m json.tool
```

---

### `chat.prompt`

Send a prompt — to a new session or into an existing one. Equivalent to `SendPromptIntent`.

**Params:**

| Name            | Type       | Default | Description                                                                                         |
|-----------------|------------|---------|-----------------------------------------------------------------------------------------------------|
| `prompt`        | `string`   | —       | **Required.** The user message text.                                                                |
| `sessionId`     | `string`   | `null`  | Existing session to continue. Omit to create a new session (with `source: "debug"`).                |
| `attachments`   | `[object]` | `[]`    | Array of `{name, data, mime?}` — `data` is base64. Each file is attached to the outgoing message.   |
| `thinkingLevel` | `string`   | `null`  | Override thinking level for this turn: `"off"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`. `null` = use session default. |
| `modelEntryId`  | `string`   | `null`  | Pin to a specific model entry (from `chat.models.list.entries[].id`). Mutually exclusive with `modelGroupId`. |
| `modelGroupId`  | `string`   | `null`  | Pin to a specific model group (from `chat.models.list.groups[].id`). The group's routing strategy decides which member runs the turn. |
| `wait`          | `bool`     | `false` | If `true`, block until the agent finishes and return the full response text.                        |
| `waitTimeout`   | `int`      | `600`   | Seconds to wait when `wait=true`. Clamped to `[1, 1800]`. On timeout, returns `status: "Timeout"` with the session still running. |

**Response:**

```json
{
  "sessionId": "6D0F…",
  "isNewSession": true,
  "modelName": "DeepSeek V4 Flash",
  "status": "Running",
  "prompt": "Summarize the release notes.",
  "responseText": null,
  "userMessageId": "msg_abc"
}
```

When `wait=true` and the agent completes: `status: "Completed"`, `responseText` is the full last-assistant text, and `tokenUsage` is populated with this turn's usage.

Model-override semantics: if exactly one of `modelEntryId` / `modelGroupId` is supplied, it's applied as this turn's binding. For new sessions the override persists as the session's default binding (so subsequent calls on the same `sessionId` don't need to repeat it); for existing sessions it's applied just for this turn, leaving the session's stored binding untouched. Supplying both returns `{ "error": { "code": -32602, "message": "modelEntryId and modelGroupId are mutually exclusive" } }`. Supplying an ID that doesn't exist or refers to a disabled provider returns `-32602` as well.

**Example — new session with image attachment, wait for result:**

```bash
curl -s http://localhost:8321 -d "{
  \"jsonrpc\": \"2.0\", \"id\": 3,
  \"method\": \"chat.prompt\",
  \"params\": {
    \"prompt\": \"What's in this image?\",
    \"attachments\": [{\"name\": \"photo.jpg\", \"data\": \"$(base64 < photo.jpg)\"}],
    \"wait\": true
  }
}" | python3 -m json.tool
```

**Example — continue an existing session, async:**

```bash
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 4,
  "method": "chat.prompt",
  "params": { "sessionId": "6D0F…", "prompt": "Now translate it to French." }
}' | python3 -m json.tool
```

---

### `chat.retry`

Retry from a specific user message in a session. Equivalent to `RetryRunIntent`. All messages after the target are deleted; the agent re-runs from that point with optional replacement attachments.

**Params:**

| Name                | Type       | Default | Description                                                                               |
|---------------------|------------|---------|-------------------------------------------------------------------------------------------|
| `sessionId`         | `string`   | —       | **Required.** Target session.                                                             |
| `messageId`         | `string`   | `null`  | ID of the user message to retry from. Omit to retry from the most recent user message.    |
| `replaceAttachments`| `[object]` | `null`  | Same shape as `chat.prompt`'s `attachments`. When provided, replaces the target message's original attachments. `null` = keep originals. `[]` = explicitly drop all attachments. |
| `modelEntryId`      | `string`   | `null`  | Pin the retry to a specific model entry (from `chat.models.list`). Mutually exclusive with `modelGroupId`. Applies just to this retry — session binding is untouched. |
| `modelGroupId`      | `string`   | `null`  | Pin the retry to a specific model group. The group's routing strategy picks the member. Applies just to this retry. |
| `thinkingLevel`     | `string`   | `null`  | Override thinking level for this retry (same values as `chat.prompt`).                    |
| `wait`              | `bool`     | `false` | Block until retry completes.                                                              |
| `waitTimeout`       | `int`      | `600`   | Same semantics as `chat.prompt`.                                                          |

**Response:**

```json
{
  "sessionId": "6D0F…",
  "status": "Retrying",
  "retriedMessageId": "msg_abc",
  "deletedMessageCount": 3,
  "modelName": "DeepSeek V4 Flash",
  "responseText": null
}
```

Returns `{ "error": { "code": -32602, "message": "Session has no user messages" } }` if the session is empty or `messageId` doesn't point to a user message.

**Example — retry with a different model to A/B compare outputs:**

```bash
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 5,
  "method": "chat.retry",
  "params": {
    "sessionId": "6D0F…",
    "messageId": "msg_abc",
    "modelEntryId": "entry_claude_sonnet",
    "wait": true
  }
}' | python3 -m json.tool
```

---

### `chat.session.status`

Poll a session's live status. Equivalent to `GetSessionStatusIntent` — useful after an async `chat.prompt` or `chat.retry`.

**Params:**

| Name        | Type     | Default | Description                     |
|-------------|----------|---------|---------------------------------|
| `sessionId` | `string` | —       | **Required.**                   |

**Response:**

```json
{
  "sessionId": "6D0F…",
  "title": "Draft a release note",
  "modelName": "DeepSeek V4 Flash",
  "isRunning": true,
  "lastMessage": "Running shell_execute…",
  "lastTool": "shell: head notes.md",
  "updatedAt": "2026-04-24T05:18:51.827Z"
}
```

`isRunning` comes from `SessionActivityTracker`; `lastTool` is the most recent tool-call summary (`toolSummary ?? toolDescription`) from the cached view model, or empty if the VM has been evicted.

**Example — polling loop:**

```bash
while true; do
  state=$(curl -s http://localhost:8321 -d '{
    "jsonrpc":"2.0","id":1,"method":"chat.session.status",
    "params":{"sessionId":"6D0F…"}}' | python3 -c "import json,sys;print(json.load(sys.stdin)['result']['isRunning'])")
  [ "$state" = "False" ] && break
  sleep 2
done
```

---

### `chat.session.cancel`

Abort an in-progress agent run in a session. No-op if the session isn't running.

**Params:**

| Name        | Type     | Default | Description   |
|-------------|----------|---------|---------------|
| `sessionId` | `string` | —       | **Required.** |

**Response:**

```json
{ "sessionId": "6D0F…", "wasRunning": true, "cancelled": true }
```

---

### `chat.session.delete`

Permanently delete a session and its messages. Irreversible — intended for test harness cleanup.

**Params:**

| Name        | Type     | Default | Description                                                                          |
|-------------|----------|---------|--------------------------------------------------------------------------------------|
| `sessionId` | `string` | —       | **Required.**                                                                        |
| `confirm`   | `bool`   | `false` | Must be `true` — guards against accidental deletion. Returns an error when omitted.  |

**Response:**

```json
{ "sessionId": "6D0F…", "deleted": true }
```

---

## Log Methods

These methods provide remote access to the app's file-based logging system (`LoggingManager`). Logs are daily-rotated files stored in `Library/Logs/` with the naming pattern `minis-YYYY-MM-dd.log`.

### `debug.logs.list`

List all log files and current logging status.

**Params:** None.

**Response:**

```json
{
  "enabled": true,
  "logDirectory": "/path/to/Library/Logs",
  "totalSize": 524288,
  "files": [
    { "name": "minis-2026-03-07.log", "size": 102400, "modified": "2026-03-07T14:30:00Z" },
    { "name": "minis-2026-03-06.log", "size": 421888, "modified": "2026-03-06T23:59:59Z" }
  ]
}
```

**Example:**

```bash
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 1,
  "method": "debug.logs.list",
  "params": {}
}' | python3 -m json.tool
```

---

### `debug.logs.read`

Read the contents of a specific log file.

**Params:**

| Name     | Type     | Default  | Description                                    |
|----------|----------|----------|------------------------------------------------|
| `name`   | `string` | —        | **Required.** Log filename (e.g. `"minis-2026-03-07.log"`) |
| `offset` | `int`    | —        | Byte offset to start reading from              |
| `limit`  | `int`    | `524288` | Maximum bytes to read (default 512KB)          |

**Response:**

```json
{
  "name": "minis-2026-03-07.log",
  "size": 102400,
  "content": "[14:30:05] App started...\n[14:30:06] ...",
  "bytesRead": 102400
}
```

If the file is larger than `limit`, the response includes `"truncated": true`. Use `offset` to paginate through large log files.

**Example:**

```bash
# Read today's log
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 2,
  "method": "debug.logs.read",
  "params": { "name": "minis-2026-03-07.log" }
}' | python3 -m json.tool

# Read last 10KB of a log file
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 3,
  "method": "debug.logs.read",
  "params": { "name": "minis-2026-03-06.log", "offset": 92400, "limit": 10240 }
}' | python3 -m json.tool
```

---

### `debug.logs.setEnabled`

Enable or disable log collection at runtime.

**Params:**

| Name      | Type   | Default | Description                          |
|-----------|--------|---------|--------------------------------------|
| `enabled` | `bool` | —       | **Required.** `true` to start capturing, `false` to stop |

**Response:**

```json
{ "enabled": true }
```

**Example:**

```bash
# Enable logging
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 4,
  "method": "debug.logs.setEnabled",
  "params": { "enabled": true }
}' | python3 -m json.tool

# Disable logging
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 5,
  "method": "debug.logs.setEnabled",
  "params": { "enabled": false }
}' | python3 -m json.tool
```

---

## Browser Debug Methods

These methods allow remote inspection and interaction with the in-app browser (BrowserTabPool). A browser session must be active (at least one tab open) for these methods to work.

### `debug.browser.listTabs`

List all open browser tabs.

**Params:** None.

**Response:**

```json
{
  "tabs": [
    {
      "id": 0,
      "url": "https://example.com",
      "title": "Example Domain",
      "selected": true,
      "inUse": false
    }
  ]
}
```

**Example:**

```bash
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 1,
  "method": "debug.browser.listTabs",
  "params": {}
}' | python3 -m json.tool
```

---

### `debug.browser.pageInfo`

Get detailed page information for a tab including URL, title, viewport dimensions, scroll position, and ready state.

**Params:**

| Name    | Type  | Default        | Description                        |
|---------|-------|----------------|------------------------------------|
| `tabId` | `int` | selected tab   | Target tab ID (from `listTabs`)    |

**Response:**

```json
{
  "tabId": 0,
  "url": "https://example.com",
  "title": "Example Domain",
  "isLoading": false,
  "canGoBack": true,
  "canGoForward": false,
  "viewport": {
    "scrollX": 0,
    "scrollY": 150,
    "pageWidth": 980,
    "pageHeight": 4200,
    "viewportWidth": 390,
    "viewportHeight": 844,
    "readyState": "complete"
  }
}
```

**Example:**

```bash
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 2,
  "method": "debug.browser.pageInfo",
  "params": {}
}' | python3 -m json.tool
```

---

### `debug.browser.executeJS`

Execute arbitrary JavaScript in a tab's WKWebView and return the result.

**Params:**

| Name     | Type     | Default      | Description                         |
|----------|----------|--------------|-------------------------------------|
| `script` | `string` | —            | **Required.** JavaScript to execute |
| `tabId`  | `int`    | selected tab | Target tab ID                       |

**Response:**

```json
{ "result": "Example Domain" }
```

The result value matches whatever the JavaScript expression evaluates to (string, number, boolean, null).

**Example:**

```bash
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 3,
  "method": "debug.browser.executeJS",
  "params": { "script": "document.title" }
}' | python3 -m json.tool
```

---

### `debug.browser.getReadable`

Run the Readability-style content extraction on a tab's page. Returns structured content with debug metadata — useful for diagnosing `get_readable` issues in agent flows.

**Params:**

| Name    | Type  | Default      | Description    |
|---------|-------|--------------|----------------|
| `tabId` | `int` | selected tab | Target tab ID  |

**Response:**

Returns the full JSON result from the `getReadable` JavaScript extraction, including `text`, `length`, and `debug` fields.

**Example:**

```bash
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 4,
  "method": "debug.browser.getReadable",
  "params": {}
}' | python3 -m json.tool
```

---

### `debug.browser.getText`

Extract text content from the page, optionally scoped to a CSS selector.

**Params:**

| Name       | Type     | Default      | Description                                |
|------------|----------|--------------|--------------------------------------------|
| `selector` | `string` | —            | CSS selector to scope text extraction      |
| `tabId`    | `int`    | selected tab | Target tab ID                              |

**Response:**

Returns the full JSON result from the `getText` JavaScript extraction, including `text`, `length`, and `debug` fields.

**Example:**

```bash
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 5,
  "method": "debug.browser.getText",
  "params": { "selector": "article" }
}' | python3 -m json.tool
```

---

### `debug.browser.screenshot`

Capture a PNG screenshot of a tab's WKWebView.

**Params:**

| Name    | Type  | Default      | Description    |
|---------|-------|--------------|----------------|
| `tabId` | `int` | selected tab | Target tab ID  |

**Response:**

```json
{
  "base64": "<base64-encoded PNG data>",
  "size": 123456,
  "encoding": "png"
}
```

**Example:**

```bash
# Save screenshot to file
curl -s http://localhost:8321 -d '{
  "jsonrpc": "2.0", "id": 6,
  "method": "debug.browser.screenshot",
  "params": {}
}' | python3 -c "
import json, sys, base64
r = json.load(sys.stdin)
with open('screenshot.png', 'wb') as f:
    f.write(base64.b64decode(r['result']['base64']))
print('Saved screenshot.png')
"
```

---

## Error Codes

| Code     | Meaning                |
|----------|------------------------|
| `-32700` | Parse error            |
| `-32600` | Invalid request        |
| `-32601` | Method not found       |
| `-32602` | Invalid params         |
| `-32000` | Internal server error  |

### Browser-Specific Errors

| Message                      | Cause                                         |
|------------------------------|-----------------------------------------------|
| `"No active browser session"` | No `BrowserTabPool` instance exists           |
| `"No tabs open"`             | Pool exists but has no tabs                   |
| `"Tab not found: N"`         | Specified `tabId` doesn't match any open tab  |

## Quick Start

```bash
# 1. Get the full view tree (depth-limited)
curl -s localhost:8321 -d '{"jsonrpc":"2.0","id":1,"method":"debug.viewTree","params":{"maxDepth":3}}' | python3 -m json.tool

# 2. Search for a specific view type
curl -s localhost:8321 -d '{"jsonrpc":"2.0","id":2,"method":"debug.search","params":{"keyword":"ScrollView"}}' | python3 -m json.tool

# 3. Inspect a view by address (from step 1 or 2)
curl -s localhost:8321 -d '{"jsonrpc":"2.0","id":3,"method":"debug.inspect","params":{"address":"0x1234abcd"}}' | python3 -m json.tool

# 4. Highlight it on screen
curl -s localhost:8321 -d '{"jsonrpc":"2.0","id":4,"method":"debug.highlight","params":{"address":"0x1234abcd","color":"green"}}' | python3 -m json.tool

# 5. List browser tabs
curl -s localhost:8321 -d '{"jsonrpc":"2.0","id":5,"method":"debug.browser.listTabs","params":{}}' | python3 -m json.tool

# 6. Execute JS in the active browser tab
curl -s localhost:8321 -d '{"jsonrpc":"2.0","id":6,"method":"debug.browser.executeJS","params":{"script":"document.title"}}' | python3 -m json.tool

# 7. Get readable content from the active tab
curl -s localhost:8321 -d '{"jsonrpc":"2.0","id":7,"method":"debug.browser.getReadable","params":{}}' | python3 -m json.tool

# 8. Get recent LLM requests
curl -s localhost:8321 -d '{"jsonrpc":"2.0","id":8,"method":"debug.llmRequests","params":{}}' | python3 -m json.tool

# 9. List log files
curl -s localhost:8321 -d '{"jsonrpc":"2.0","id":9,"method":"debug.logs.list","params":{}}' | python3 -m json.tool

# 10. Read a log file
curl -s localhost:8321 -d '{"jsonrpc":"2.0","id":10,"method":"debug.logs.read","params":{"name":"minis-2026-03-07.log"}}' | python3 -m json.tool

# 11. Enable/disable log collection
curl -s localhost:8321 -d '{"jsonrpc":"2.0","id":11,"method":"debug.logs.setEnabled","params":{"enabled":true}}' | python3 -m json.tool

# 12. Capture app screenshot
curl -s localhost:8321 -d '{"jsonrpc":"2.0","id":12,"method":"debug.screenshot","params":{"scale":2}}' | python3 -c "import json,sys,base64;r=json.load(sys.stdin);open('screenshot.png','wb').write(base64.b64decode(r['result']['base64']))"
```
