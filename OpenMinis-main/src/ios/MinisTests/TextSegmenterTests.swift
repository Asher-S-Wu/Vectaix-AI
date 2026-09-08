import XCTest

final class TextSegmenterTests: XCTestCase {

    // MARK: - Language Detection

    func testIsMajorityChinese_pureHanzi() {
        let seg = TextSegmenter.shared
        XCTAssertTrue(seg.isMajorityChinese("苹果手机很好用"))
    }

    /// "他在Google工作了3年" is 6 Han chars out of 13 non-whitespace = 46.2%, i.e.
    /// BELOW the 50% threshold, so it routes to NLTokenizer. (Latin model names and
    /// digits dilute the Han ratio quickly; a longer Chinese sentence around the
    /// same embedded English clears the bar — see `testIsMajorityChinese_mixedChineseWithEnglish`.)
    func testIsMajorityChinese_mixedBelowThreshold() {
        let seg = TextSegmenter.shared
        XCTAssertFalse(seg.isMajorityChinese("他在Google工作了3年"))
    }

    func testIsMajorityChinese_mixedChineseWithEnglish() {
        let seg = TextSegmenter.shared
        // 7/13 = 53.8% Han → jieba.
        XCTAssertTrue(seg.isMajorityChinese("苹果iPhone手机很好用"))
        // 10/17 = 58.8% Han → jieba.
        XCTAssertTrue(seg.isMajorityChinese("这个API接口返回JSON格式数据"))
    }

    func testIsMajorityChinese_pureEnglish() {
        let seg = TextSegmenter.shared
        XCTAssertFalse(seg.isMajorityChinese("Hello world how are you"))
    }

    func testIsMajorityChinese_japanese() {
        let seg = TextSegmenter.shared
        XCTAssertFalse(seg.isMajorityChinese("東京は日本の首都です"))
    }

    func testIsMajorityChinese_empty() {
        let seg = TextSegmenter.shared
        XCTAssertFalse(seg.isMajorityChinese(""))
        XCTAssertFalse(seg.isMajorityChinese("   "))
    }

    // MARK: - Segment API (empty / whitespace)

    func testSegment_empty() {
        XCTAssertEqual(TextSegmenter.shared.segment(""), [])
    }

    func testSegment_whitespaceOnly() {
        XCTAssertEqual(TextSegmenter.shared.segment("   "), [])
    }

    // MARK: - NLTokenizer path

    func testSegment_englishUsesNLTokenizer() {
        let result = TextSegmenter.shared.segment("Hello world how are you")
        XCTAssertEqual(result, ["Hello", "world", "how", "are", "you"])
    }

    func testSegment_englishSentence() {
        let result = TextSegmenter.shared.segment("The quick brown fox jumps")
        XCTAssertEqual(result, ["The", "quick", "brown", "fox", "jumps"])
    }

    func testSegment_singleChar() {
        let result = TextSegmenter.shared.segment("A")
        XCTAssertEqual(result, ["A"])
    }

    // MARK: - Chinese (Jieba) path

    func testSegment_chineseSentence() {
        let result = TextSegmenter.shared.segment("苹果iPhone手机很好用")
        XCTAssertFalse(result.isEmpty, "Should produce tokens for Chinese text")
        XCTAssertTrue(result.contains("苹果"), "Should contain '苹果'")
    }

    func testSegment_chineseAmbiguity_wedding() {
        let result = TextSegmenter.shared.segment("结婚的和尚未结婚的")
        XCTAssertTrue(result.contains("尚未"), "Should segment '尚未' correctly")
    }

    func testSegment_chineseAmbiguity_pingpong() {
        let result = TextSegmenter.shared.segment("乒乓球拍卖完了")
        XCTAssertTrue(result.contains("乒乓球"), "Should segment '乒乓球' correctly")
        XCTAssertTrue(result.contains("拍卖"), "Should segment '拍卖' correctly")
    }

    func testSegment_chineseProperNouns() {
        let result = TextSegmenter.shared.segment("马云在杭州创办了阿里巴巴集团")
        XCTAssertTrue(result.contains("杭州"), "Should identify '杭州'")
        XCTAssertTrue(result.contains("阿里巴巴"), "Should identify '阿里巴巴'")
    }

    func testSegmentForSearch_chineseFinerGranularity() {
        let result = TextSegmenter.shared.segmentForSearch("中国科学院计算技术研究所")
        XCTAssertFalse(result.isEmpty)
        XCTAssertTrue(result.count >= 2, "Search mode should produce multiple tokens")
    }

    // MARK: - Performance

    func testPerformance_10kChineseCharacters() {
        let base = "中华人民共和国是一个伟大的国家我们热爱和平"
        let longText = String(repeating: base, count: 500)
        measure {
            _ = TextSegmenter.shared.segment(longText)
        }
    }
}
