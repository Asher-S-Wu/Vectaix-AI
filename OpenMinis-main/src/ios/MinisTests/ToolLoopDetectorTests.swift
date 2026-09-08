import XCTest

final class ToolLoopDetectorTests: XCTestCase {

    // MARK: - Strategy 4: generic_repeat

    func testGenericRepeat_emitsWarningAtThreshold() {
        let detector = ToolLoopDetector()
        let params: [String: Any] = ["path": "/tmp/foo"]

        // First 9 calls: pre-check passes; record after each call so history grows.
        for i in 1...9 {
            let pre = detector.check(toolName: "file_read", params: params)
            XCTAssertEqual(pre.level, .none, "iter \(i): expected pass")
            _ = detector.record(toolName: "file_read", params: params, result: "<file content i=\(i)>")
        }

        // 10th call: still none from pre-check (it inspects history of 9), but the
        // post-record call should now report warning since count crosses threshold.
        let pre10 = detector.check(toolName: "file_read", params: params)
        XCTAssertEqual(pre10.level, .none)
        let post10 = detector.record(toolName: "file_read", params: params, result: "<file content i=10>")
        XCTAssertEqual(post10.level, .warning)
        XCTAssertNotNil(post10.message)
        XCTAssertTrue(post10.message?.contains("[LOOP WARNING]") == true)
    }

    func testGenericRepeat_differentArgsDoNotAccumulate() {
        let detector = ToolLoopDetector()
        for i in 0..<15 {
            let params: [String: Any] = ["path": "/tmp/file_\(i)"]
            _ = detector.record(toolName: "file_read", params: params, result: "ok")
        }
        let pre = detector.check(toolName: "file_read", params: ["path": "/tmp/file_99"])
        XCTAssertEqual(pre.level, .none, "different args should not trigger generic_repeat")
    }

    // MARK: - Strategy 2: unknown_tool_repeat

    func testUnknownToolRepeat_blocksAtTenConsecutive() {
        let detector = ToolLoopDetector()
        let toolName = "foobar_tool"
        let params: [String: Any] = ["x": 1]

        // 9 prior unknown errors: not yet blocked.
        for _ in 0..<9 {
            _ = detector.record(
                toolName: toolName,
                params: params,
                result: nil,
                errorMessage: "unknown tool: \(toolName)"
            )
        }

        let pre = detector.check(toolName: toolName, params: params)
        XCTAssertEqual(pre.level, .critical, "10th attempt should be blocked")
        XCTAssertTrue(pre.message?.contains("[LOOP BLOCKED]") == true)
        XCTAssertTrue(pre.message?.contains(toolName) == true)
    }

    func testUnknownToolRepeat_recoveryOnDifferentToolDoesNotBlock() {
        let detector = ToolLoopDetector()
        // 9 unknown errors for tool A.
        for _ in 0..<9 {
            _ = detector.record(
                toolName: "ghost_a",
                params: [:],
                result: nil,
                errorMessage: "unknown tool: ghost_a"
            )
        }
        // A different tool name should not be blocked by ghost_a's streak.
        let pre = detector.check(toolName: "ghost_b", params: [:])
        XCTAssertEqual(pre.level, .none)
    }

    // MARK: - Strategy 3: known_poll_no_progress

    func testPollNoProgress_warningAtTenCriticalAtTwenty() {
        let detector = ToolLoopDetector()
        let params: [String: Any] = ["pid": 1234]
        let stableResult = "{\"status\":\"running\",\"output\":\"\"}"

        // Record 9 identical poll results; pre-check still passes.
        for _ in 0..<9 {
            _ = detector.record(toolName: "command_status", params: params, result: stableResult)
        }
        XCTAssertEqual(
            detector.check(toolName: "command_status", params: params).level, .none
        )

        // 10th record fires the warning.
        let post10 = detector.record(toolName: "command_status", params: params, result: stableResult)
        XCTAssertEqual(post10.level, .warning)

        // Continue to 19 — pre-check returns warning (already past threshold)
        // but throttle keeps it bucketed; we mainly care about the 20th hitting critical.
        for _ in 10..<19 {
            _ = detector.record(toolName: "command_status", params: params, result: stableResult)
        }

        // 20th attempt's pre-check should be CRITICAL.
        let pre20 = detector.check(toolName: "command_status", params: params)
        XCTAssertEqual(pre20.level, .critical, "20 identical no-progress polls should hit critical")
        XCTAssertTrue(pre20.message?.contains("[LOOP BLOCKED]") == true)
    }

    func testPollNoProgress_resetsWhenResultChanges() {
        let detector = ToolLoopDetector()
        let params: [String: Any] = ["pid": 1234]

        // 9 identical no-progress results.
        for _ in 0..<9 {
            _ = detector.record(
                toolName: "command_status",
                params: params,
                result: "{\"status\":\"running\"}"
            )
        }
        // Result changes → no-progress streak should reset.
        _ = detector.record(
            toolName: "command_status",
            params: params,
            result: "{\"status\":\"complete\"}"
        )
        // Now several more identical "complete" results; streak counts only the latest run.
        for _ in 0..<5 {
            _ = detector.record(
                toolName: "command_status",
                params: params,
                result: "{\"status\":\"complete\"}"
            )
        }
        let pre = detector.check(toolName: "command_status", params: params)
        XCTAssertEqual(pre.level, .none, "result change should reset no-progress streak")
    }

    // MARK: - Strategy 1: global_circuit_breaker

    func testGlobalCircuitBreaker_blocksAtThirty() {
        // Use a custom config with a slightly larger window so we can fill 29 records.
        let detector = ToolLoopDetector(
            config: ToolLoopConfig(historySize: 60)
        )
        let params: [String: Any] = ["k": "v"]
        let result = "{\"status\":\"same\"}"

        // Record 29 identical no-progress results for a non-poll tool.
        for _ in 0..<29 {
            _ = detector.record(toolName: "weird_tool", params: params, result: result)
        }
        // 30th attempt: global circuit breaker should fire (critical).
        let pre = detector.check(toolName: "weird_tool", params: params)
        XCTAssertEqual(pre.level, .critical)
        XCTAssertTrue(pre.message?.contains("global circuit breaker") == true)
    }

    // MARK: - Reset

    func testReset_clearsState() {
        let detector = ToolLoopDetector()
        for _ in 0..<15 {
            _ = detector.record(toolName: "file_read", params: ["p": "x"], result: "ok")
        }
        detector.reset()
        let pre = detector.check(toolName: "file_read", params: ["p": "x"])
        XCTAssertEqual(pre.level, .none, "reset should clear history")
    }

    // MARK: - Stable hashing

    func testArgsHash_ignoresToolTitle() {
        // The model is required by tool schema to provide `tool_title` (a UI label).
        // Models often suffix it with a counter ("#1", "#2", ...), which must NOT
        // make logically-identical calls look unique to the detector.
        let detector = ToolLoopDetector()
        for i in 1...10 {
            let params: [String: Any] = [
                "path": "/etc/hostname",
                "tool_title": "Read /etc/hostname #\(i)",
            ]
            _ = detector.record(toolName: "file_read", params: params, result: "localhost")
        }
        let pre = detector.check(
            toolName: "file_read",
            params: ["path": "/etc/hostname", "tool_title": "Read /etc/hostname #11"]
        )
        XCTAssertNotEqual(pre.level, .none, "tool_title variation must NOT defeat repeat detection")
    }

    func testArgsHash_keyOrderInvariant() {
        // Two equivalent param dicts that differ only in iteration order must collapse.
        let detector = ToolLoopDetector()
        let p1: [String: Any] = ["a": 1, "b": 2, "c": 3]
        let p2: [String: Any] = ["c": 3, "b": 2, "a": 1]

        for _ in 0..<5 {
            _ = detector.record(toolName: "file_read", params: p1, result: "ok")
        }
        for _ in 0..<5 {
            _ = detector.record(toolName: "file_read", params: p2, result: "ok")
        }
        // 10 total (with stable hashing) → next pre-check sees count=10 → warning.
        let post = detector.record(toolName: "file_read", params: p2, result: "ok")
        XCTAssertEqual(post.level, .warning, "key-order-invariant hashing must collapse to a single bucket")
    }
}
