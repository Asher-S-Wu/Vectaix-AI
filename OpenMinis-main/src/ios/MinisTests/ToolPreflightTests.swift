import XCTest
@testable import Minis

/// [T-preflight-empty-string-allowed] preflightValidateToolCall must
/// distinguish "field absent / JSON null" (block) from "field present with a
/// legitimately empty string" (allow, per-tool whitelist — file_edit's schema
/// documents `new_string: ""` as the delete-old_string form).
final class ToolPreflightTests: XCTestCase {

    private var tools: [AgentToolDefinition] {
        [
            AgentToolDefinition(
                name: "file_edit",
                description: "Edit a file",
                parameters: [
                    "path": AgentToolParam(type: .string, description: "File path"),
                    "old_string": AgentToolParam(type: .string, description: "Text to replace"),
                    "new_string": AgentToolParam(type: .string, description: "Replacement. Use empty string to delete old_string."),
                ],
                required: ["path", "old_string", "new_string"]
            ),
            AgentToolDefinition(
                name: "shell_execute",
                description: "Run a shell command",
                parameters: [
                    "command": AgentToolParam(type: .string, description: "Command"),
                ],
                required: ["command"]
            ),
        ]
    }

    private func validate(_ name: String, _ args: [String: Any]) -> String? {
        AIChatViewModel.preflightValidateToolCall(name: name, args: args, tools: tools)
    }

    // MARK: - file_edit.new_string empty-string whitelist

    func testFileEdit_emptyNewString_isAllowed() {
        let err = validate("file_edit", [
            "path": "/var/minis/workspace/a.txt",
            "old_string": "delete me",
            "new_string": "",
        ])
        XCTAssertNil(err, "empty new_string is the documented delete form and must pass preflight")
    }

    func testFileEdit_missingNewString_isBlocked() {
        let err = validate("file_edit", [
            "path": "/var/minis/workspace/a.txt",
            "old_string": "delete me",
        ])
        XCTAssertNotNil(err)
        XCTAssertTrue(err?.contains("new_string") == true)
    }

    func testFileEdit_nullNewString_isBlocked() {
        let err = validate("file_edit", [
            "path": "/var/minis/workspace/a.txt",
            "old_string": "delete me",
            "new_string": NSNull(),
        ])
        XCTAssertNotNil(err, "JSON null is a missing value, not an empty string")
        XCTAssertTrue(err?.contains("new_string") == true)
    }

    func testFileEdit_emptyOldString_isStillBlocked() {
        // The whitelist is per-field: only new_string may be empty.
        let err = validate("file_edit", [
            "path": "/var/minis/workspace/a.txt",
            "old_string": "",
            "new_string": "x",
        ])
        XCTAssertNotNil(err)
        XCTAssertTrue(err?.contains("old_string") == true)
    }

    // MARK: - Non-whitelisted tools keep the original behavior

    func testShellExecute_emptyCommand_isBlocked() {
        let err = validate("shell_execute", ["command": ""])
        XCTAssertNotNil(err)
        XCTAssertTrue(err?.contains("command") == true)
    }

    func testShellExecute_validCommand_passes() {
        XCTAssertNil(validate("shell_execute", ["command": "ls -l"]))
    }

    // MARK: - Pre-existing behaviors unchanged

    func testUnknownTool_staysSilent() {
        XCTAssertNil(validate("no_such_tool", [:]))
    }

    func testEmptyArgs_isBlocked() {
        let err = validate("file_edit", [:])
        XCTAssertNotNil(err)
        XCTAssertTrue(err?.contains("empty arguments") == true)
    }

    func testWhitespaceOnlyString_passes() {
        // "\n" / "  " are legitimate payloads (documented in the validator);
        // the trim-then-reject behavior must not come back.
        XCTAssertNil(validate("file_edit", [
            "path": "/var/minis/workspace/a.txt",
            "old_string": "  ",
            "new_string": "\n",
        ]))
    }
}
