package com.openminis.app.service

/**
 * T-overlay-glyph-typed-outcome: typed outcome of a completed tool call.
 *
 * Replaces the old `ToolOverlayController.looksLikeFailure(statusText)`
 * heuristic, which scanned the stale "Running: foo" status string left
 * behind by [SessionActivityTracker] and therefore always inferred
 * success. Call sites that know the outcome (success path / catch block
 * / cancellation) now pass the typed value into
 * [SessionActivityTracker.clearToolRunning]; the overlay reads it
 * directly to render the correct glyph.
 *
 * - [Success]   – the tool returned a result that the agent loop
 *                 accepted (non-throwing, non-timeout, non-cancel).
 * - [Error]     – the tool threw, returned a non-OK exitCode, or was
 *                 otherwise marked failed by the chat loop.
 * - [Timeout]   – the tool exceeded its watchdog timeout.
 * - [Cancelled] – the user cancelled mid-stream (Stop button, etc.).
 * - [Unknown]   – default for legacy callers / paths that don't yet
 *                 supply an outcome; the overlay treats this as "no
 *                 glyph" (hidden / gray) so we don't pretend to know.
 */
enum class ToolOutcome {
    Success,
    Error,
    Timeout,
    Cancelled,
    Unknown,
}
