import XCTest

/// [T-oauth-refresh-race-classify] Tests for the structured refresh-error
/// classifier that replaced the naive `msg.contains("400") || ...` substring
/// test. The whole point is to STOP false positives (a benign body number/word
/// classified as a fatal token-invalid error → credential deletion → silent
/// logout) while still catching genuine token rejections.
final class OAuthRefreshErrorClassifierTests: XCTestCase {

    private let googleFatal: Set<String> = ["invalid_grant", "invalid_token", "invalid_request", "unauthorized_client"]
    private let rotatingFatal: Set<String> = ["invalid_grant", "invalid_token", "invalid_request", "unauthorized_client", "refresh_token_reused"]

    private func msg(status: Int, body: String) -> LLMError {
        .providerError(message: "Token refresh failed: " + OAuthRefreshErrorClassifier.makeErrorMessage(status: status, body: body))
    }

    // MARK: - Genuine fatal cases are still caught

    func testJSONInvalidGrant_isFatal() {
        let e = msg(status: 400, body: "{\"error\":\"invalid_grant\",\"error_description\":\"Refresh token not found or invalid\"}")
        XCTAssertTrue(OAuthRefreshErrorClassifier.isTokenInvalid(e, fatalErrorCodes: googleFatal))
    }

    func test401_isFatal_evenWithUnknownBody() {
        let e = msg(status: 401, body: "Unauthorized")
        XCTAssertTrue(OAuthRefreshErrorClassifier.isTokenInvalid(e, fatalErrorCodes: googleFatal))
    }

    func testRefreshTokenReused_plainText_isFatal_forRotatingProviders() {
        // xAI/Codex may return reuse as a non-JSON body; whole-token fallback catches it.
        let e = msg(status: 200, body: "error: refresh_token_reused")
        XCTAssertTrue(OAuthRefreshErrorClassifier.isTokenInvalid(e, fatalErrorCodes: rotatingFatal))
    }

    func testRefreshTokenReused_JSON_isFatal() {
        let e = msg(status: 400, body: "{\"error\":\"refresh_token_reused\"}")
        XCTAssertTrue(OAuthRefreshErrorClassifier.isTokenInvalid(e, fatalErrorCodes: rotatingFatal))
    }

    // MARK: - False positives the OLD substring test would have WRONGLY flagged

    func test500WithBodyContaining400_isNotFatal() {
        // Transient server error (500). Body mentions "400" as a request-id
        // fragment. OLD code: msg.contains("400") → true → DELETE. New: 500 not
        // in fatal statuses, no fatal error code → transient, keep token.
        let e = msg(status: 500, body: "{\"error\":\"internal\",\"request_id\":\"req-4001abc\"}")
        XCTAssertFalse(OAuthRefreshErrorClassifier.isTokenInvalid(e, fatalErrorCodes: googleFatal),
                       "a 500 whose body merely contains '400' must not be fatal")
    }

    func test503WithByteCount401_isNotFatal() {
        let e = msg(status: 503, body: "Service Unavailable (401 bytes)")
        XCTAssertFalse(OAuthRefreshErrorClassifier.isTokenInvalid(e, fatalErrorCodes: googleFatal),
                       "a 503 with '401' as a byte count must not be fatal")
    }

    func testRefreshTokenExpiryFieldName_isNotFatal() {
        // Body mentions the substring "refresh_token" inside a field NAME. OLD
        // Codex classifier had bare msg.contains("refresh_token") → true → DELETE.
        // New: whole-token match on "refresh_token_reused" fails; no fatal code;
        // 200 not fatal → keep.
        let e = msg(status: 200, body: "{\"refresh_token_expiry_ms\":\"1699999999\"}")
        XCTAssertFalse(OAuthRefreshErrorClassifier.isTokenInvalid(e, fatalErrorCodes: rotatingFatal),
                       "'refresh_token' as a field-name substring must not be fatal")
    }

    func testTransientJSONWith5xx_isNotFatal() {
        let e = msg(status: 502, body: "{\"error\":\"upstream_timeout\"}")
        XCTAssertFalse(OAuthRefreshErrorClassifier.isTokenInvalid(e, fatalErrorCodes: googleFatal))
    }

    func testNoMarker_networkErrorMessage_isNotFatal() {
        // A message from a non-token-endpoint throw site (no status marker) with
        // no fatal code must not be classified fatal.
        let e = LLMError.providerError(message: "The request timed out")
        XCTAssertFalse(OAuthRefreshErrorClassifier.isTokenInvalid(e, fatalErrorCodes: googleFatal))
    }

    func testNonProviderError_isNotFatal() {
        XCTAssertFalse(OAuthRefreshErrorClassifier.isTokenInvalid(
            LLMError.networkError(underlying: URLError(.timedOut)), fatalErrorCodes: googleFatal))
    }

    // MARK: - Provider-specific: reuse is fatal only where listed

    func testReuse_notFatal_forNonRotatingProvider() {
        // Google-style provider whose fatal set does NOT list refresh_token_reused,
        // body is a bare reuse string with a non-fatal status.
        let e = msg(status: 200, body: "refresh_token_reused")
        XCTAssertFalse(OAuthRefreshErrorClassifier.isTokenInvalid(e, fatalErrorCodes: googleFatal),
                       "reuse code must not be fatal for a provider that doesn't list it")
        XCTAssertTrue(OAuthRefreshErrorClassifier.isTokenInvalid(e, fatalErrorCodes: rotatingFatal))
    }

    // MARK: - Parsing units

    func testParseStatus() {
        XCTAssertEqual(OAuthRefreshErrorClassifier.parseStatus(from: "x oauth_http_status=403 body"), 403)
        XCTAssertNil(OAuthRefreshErrorClassifier.parseStatus(from: "no marker here 400"))
    }

    func testParseErrorCode() {
        XCTAssertEqual(
            OAuthRefreshErrorClassifier.parseErrorCode(fromBody: "oauth_http_status=400 {\"error\":\"invalid_grant\"}"),
            "invalid_grant")
        XCTAssertNil(OAuthRefreshErrorClassifier.parseErrorCode(fromBody: "oauth_http_status=500 not json"))
    }

    func testWholeTokenMatching() {
        XCTAssertTrue(OAuthRefreshErrorClassifier.containsWholeToken("invalid_grant", in: "error: invalid_grant."))
        XCTAssertFalse(OAuthRefreshErrorClassifier.containsWholeToken("refresh_token", in: "refresh_token_expiry_ms"))
        XCTAssertTrue(OAuthRefreshErrorClassifier.containsWholeToken("refresh_token", in: "the refresh_token is bad"))
    }
}
