import XCTest

final class ThinkingLevelTests: XCTestCase {

    func testDecodedKnownValues() {
        XCTAssertEqual(ThinkingLevel.decoded("off"), .off)
        XCTAssertEqual(ThinkingLevel.decoded("low"), .low)
        XCTAssertEqual(ThinkingLevel.decoded("medium"), .medium)
        XCTAssertEqual(ThinkingLevel.decoded("high"), .high)
        XCTAssertEqual(ThinkingLevel.decoded("xhigh"), .xhigh)
        XCTAssertEqual(ThinkingLevel.decoded("max"), .max)
        XCTAssertEqual(ThinkingLevel.decoded("ultra"), .ultra)
    }

    func testDecodedUnknownValueFallsBackToXHigh() {
        XCTAssertEqual(ThinkingLevel.decoded("some-future-level"), .xhigh)
        XCTAssertEqual(ThinkingLevel.decoded(""), .xhigh)
        XCTAssertEqual(ThinkingLevel.decoded("supermax"), .xhigh)
    }

    func testComparable() {
        XCTAssertTrue(ThinkingLevel.off < .low)
        XCTAssertTrue(ThinkingLevel.low < .medium)
        XCTAssertTrue(ThinkingLevel.medium < .high)
        XCTAssertTrue(ThinkingLevel.high < .xhigh)
        XCTAssertTrue(ThinkingLevel.xhigh < .max)
        XCTAssertTrue(ThinkingLevel.max < .ultra)
        XCTAssertFalse(ThinkingLevel.ultra < .off)
    }

    func testModelGroupDecodeWithUltraThinkingLevel() throws {
        let json = """
        {
            "id": "test-group",
            "name": "Test",
            "memberEntryIds": [],
            "strategy": "fallback",
            "defaultThinkingLevel": "ultra"
        }
        """.data(using: .utf8)!
        let group = try JSONDecoder().decode(ModelGroup.self, from: json)
        XCTAssertEqual(group.defaultThinkingLevel, .ultra)
    }

    func testModelGroupDecodeWithUnknownThinkingLevel() throws {
        let json = """
        {
            "id": "test-group",
            "name": "Test",
            "memberEntryIds": [],
            "strategy": "fallback",
            "defaultThinkingLevel": "some-future-level"
        }
        """.data(using: .utf8)!
        let group = try JSONDecoder().decode(ModelGroup.self, from: json)
        XCTAssertEqual(group.defaultThinkingLevel, .xhigh)
    }

    func testSessionInferenceConfigDecodeWithUnknownLevel() throws {
        let json = """
        { "thinkingLevel": "hyper-future" }
        """.data(using: .utf8)!
        let cfg = try JSONDecoder().decode(SessionInferenceConfig.self, from: json)
        XCTAssertEqual(cfg.thinkingLevel, .xhigh)
    }
}
