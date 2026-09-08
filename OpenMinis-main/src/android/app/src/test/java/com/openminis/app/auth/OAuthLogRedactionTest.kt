package com.openminis.app.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** [T-android-oauth-log-redaction] sanitizeBody masks credential values and truncates. */
class OAuthLogRedactionTest {

    @Test
    fun `credential field values are masked`() {
        val body = """{"access_token":"sk-live-SECRET","refresh_token":"rt-SECRET2","token_type":"bearer"}"""
        val out = OAuthManager.sanitizeBody(body)
        assertFalse(out.contains("sk-live-SECRET"))
        assertFalse(out.contains("rt-SECRET2"))
        assertTrue(out.contains("\"access_token\":\"***\""))
        assertTrue(out.contains("\"refresh_token\":\"***\""))
        // Non-sensitive fields survive for diagnostics.
        assertTrue(out.contains("token_type"))
    }

    @Test
    fun `device_code and key variants are masked`() {
        val body = """{"device_code":"dc-SECRET","key":"or-KEY","client_secret":"cs-SECRET"}"""
        val out = OAuthManager.sanitizeBody(body)
        assertFalse(out.contains("dc-SECRET"))
        assertFalse(out.contains("or-KEY"))
        assertFalse(out.contains("cs-SECRET"))
    }

    @Test
    fun `plain error body passes through and long body truncates`() {
        assertEquals("""{"error":"invalid_grant"}""", OAuthManager.sanitizeBody("""{"error":"invalid_grant"}"""))
        val long = "x".repeat(1000)
        val out = OAuthManager.sanitizeBody(long)
        assertTrue(out.length < 340)
        assertTrue(out.endsWith("…(1000 chars)"))
    }
}
