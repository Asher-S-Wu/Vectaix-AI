import SwiftUI
import UIKit

// MARK: - Speech player control (read-replies TTS)
//
// A floating audio-player-style control for the "Read replies" TTS, with two
// states like the voice-input panel:
//   • expand  — a capsule showing the TTS model (tappable to switch), a speed
//               chip, a pause/resume button, and a close (×) button.
//   • compact — a small circular speaker button.
// Lifecycle:
//   - Enabling read-replies opens it EXPANDED.
//   - When the first reply utterance actually starts speaking → collapse to
//     compact.
//   - Tapping the compact button → expand.
//   - 15s of no interaction while expanded → collapse to compact.
//   - In expand mode the capsule can be DRAGGED to reposition; tapping any empty
//     area outside it collapses to compact (the tap-catcher lives in AIChatView,
//     driven by `vm.speechPlayerExpanded`).

struct SpeechPlayerControl: View {
    /// GLOBAL read-replies state — this control is a single app-root instance that
    /// persists across chat → home (mounted in MinisApp beside AudioPiPCapsule).
    @ObservedObject private var state = VoiceOutputState.shared
    /// Drives the "…" loading animation on the speaker while cloud TTS is
    /// synthesizing (network request in flight, nothing playing yet).
    @ObservedObject private var voicePlayer = VoiceOutputPlayer.shared
    /// Keyboard / scroll-button placement signals so the capsule never covers a
    /// tappable element.
    @ObservedObject private var placement = SpeechCapsulePlacement.shared
    /// Height reserved at the bottom (the control can be dragged DOWN until its
    /// bottom edge reaches just above this). App-root default = above the home
    /// indicator / tab area.
    var bottomReserve: CGFloat = 40

    /// Expand/compact — local to this single global control.
    @State private var expandedState = false
    @State private var idleCollapseToken = 0
    /// True for ~3 s after a synthesis failure → speaker icon flashes red.
    @State private var showFailureFlash = false
    @State private var showModelSelector = false
    @State private var modelLabel = ""
    /// Persistent drag offset applied to the whole control. Plain @State (NOT
    /// @GestureState) so it survives the frequent parent re-renders during TTS
    /// playback — a @GestureState reset mid-drag was the flicker source.
    @State private var dragOffset: CGSize = .zero
    /// Offset captured at drag start, so onChanged adds translation to a stable base.
    @State private var dragStart: CGSize = .zero
    /// The control's BASE (un-offset) global frame, measured once when NOT dragging.
    /// Used only at drag-END to clamp back on-screen — never read mid-drag, so the
    /// drag itself is pure 1:1 tracking with no clamp jitter.
    @State private var baseFrame: CGRect = .zero

    /// Auto-collapse after this idle period in expand mode.
    private static let idleCollapseSeconds: TimeInterval = 10
    /// Horizontal/vertical inset for the drag bounds — matched to the message
    /// content's distance from the screen edge (the chat list uses 16pt), so the
    /// capsule can't be dragged past the message content's left/right margin.
    private static let edgeMargin: CGFloat = 16

    private var expanded: Bool { expandedState }

    /// Show whenever read-replies is ON (so it can be turned off from anywhere) or
    /// something is actively playing/synthesizing. When the keyboard is up the
    /// capsule LIFTS above it (via placement.totalLift) — it stays visible, it does
    /// NOT hide. Idle + off → hidden.
    private var isActive: Bool {
        state.isEnabled || state.isReadingAloud || state.speechPaused
            || voicePlayer.isPlaying || voicePlayer.isSynthesizing || voicePlayer.hasPendingAudio
    }

    /// Default gap from the screen's bottom safe-area edge for the resting capsule.
    private static let restingBottomGap: CGFloat = 12

    /// The avoidance offset currently applied (points the capsule is lifted up).
    @State private var avoidLift: CGFloat = 0

    /// [T-voice-capsule-cramped-hide] True when the lift required to clear the
    /// obstacle stack (keyboard + a tall voice panel while the transcript is
    /// being edited) would push the capsule above the safe top region — i.e.
    /// there is no STABLE place to put it. Rather than keep re-computing a
    /// twitchy lift that makes the circular button jump/flicker as the panel and
    /// keyboard animate, we hide it (fade out) and bring it back once there's
    /// room again. Hysteresis (below) prevents flicker right at the boundary.
    @State private var spaceInsufficient = false
    /// Once hidden, require this much EXTRA headroom before showing again, so a
    /// value hovering at the threshold can't toggle hide/show every recompute.
    private static let crampedHideHysteresis: CGFloat = 24
    /// Minimum clear vertical gap that must exist between the lifted capsule's
    /// top and the safe top boundary (nav area) for a placement to count as
    /// stable. Below this the capsule is considered to have nowhere to go.
    private static let minStableHeadroom: CGFloat = 8

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            if isActive && expanded {
                Color.black.opacity(0.001)
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture {
                        VoiceLog.log("[capsule] tap-outside → collapse")
                        setExpanded(false)
                    }
            }
            if isActive {
                control
                    .padding(.trailing, 16)
                    .padding(.bottom, Self.restingBottomGap)
                    .background(
                        GeometryReader { cg in
                            Color.clear
                                .onChange(of: cg.size) { s in capsuleSize = s; scheduleRecompute() }
                                .onAppear { capsuleSize = cg.size; scheduleRecompute() }
                        }
                    )
                    .offset(y: -avoidLift)
                    .animation(.easeInOut(duration: 0.2), value: avoidLift)
                    // [T-voice-capsule-cramped-hide] Fade out when there's no
                    // stable place to lift the button into (keyboard + tall voice
                    // panel while editing the transcript). It fades smoothly back
                    // in once space recovers. `allowsHitTesting(false)` while
                    // hidden so the invisible button can't intercept taps.
                    .opacity(spaceInsufficient ? 0 : 1)
                    .allowsHitTesting(!spaceInsufficient)
                    .animation(.easeInOut(duration: 0.2), value: spaceInsufficient)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
        .ignoresSafeArea(.keyboard)
        .animation(.easeInOut(duration: 0.2), value: isActive)
        .onReceive(placement.$protectedRects) { _ in scheduleRecompute() }
        // Window resize (rotation / iPad Stage Manager / Split View): the
        // resting corner moves with the layout, but a dragged offset that was
        // valid in the old size may now push the capsule outside the window —
        // re-clamp it into the new bounds (after the base frame re-measures),
        // like the scroll-to-bottom/top buttons that are layout-constrained.
        .background(
            GeometryReader { geo in
                Color.clear.onChange(of: geo.size) { _ in scheduleReclamp() }
            }
        )
    }

    @State private var capsuleSize: CGSize = CGSize(width: 44, height: 44)
    @State private var recomputeTask: Task<Void, Never>?

    /// Resting (un-lifted) capsule frame in WINDOW coordinates, computed from
    /// UIScreen + UIKit safe-area insets — completely stable (no SwiftUI
    /// GeometryReader whose frame drifts during keyboard animation).
    private var restingFrame: CGRect {
        let screen = Self.windowBounds()
        let bottom = Self.safeAreaBottomInset()
        let w = capsuleSize.width, h = capsuleSize.height
        let maxY = screen.maxY - bottom - Self.restingBottomGap + dragOffset.height
        let maxX = screen.maxX - 16 + dragOffset.width
        return CGRect(x: maxX - w, y: maxY - h, width: w, height: h)
    }

    private func scheduleRecompute() {
        recomputeTask?.cancel()
        recomputeTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            recompute()
        }
    }

    /// [T-voice-capsule-streaming-ratchet] Pending settle-window descent; see
    /// the ratchet block at the end of `recompute`.
    @State private var descentTask: Task<Void, Never>?
    private static let descentSettleMillis = 1200

    private func recompute(allowDescent: Bool = false) {
        let rf = restingFrame
        guard rf.width > 0 else { return }
        let newLift = placement.requiredLift(forCapsule: rf)

        // [T-voice-capsule-cramped-hide] Decide whether a STABLE placement exists.
        // The lifted capsule's top must clear the safe top boundary (nav area)
        // with at least `minStableHeadroom` of slack. When the transcript is
        // being edited the keyboard + a tall (up to 60%-screen) voice panel stack
        // up and the needed lift can push the capsule to/over the top — there's
        // nowhere stable to sit, and continuing to track the animating lift makes
        // the button jitter. In that case hide it instead. Hysteresis: once
        // hidden, require extra headroom before showing again so a value sitting
        // on the threshold can't flip hide/show on every recompute.
        let liftedTop = rf.minY - newLift
        let safeTop = Self.safeAreaTopInset() + 44 + 8 // nav bar band, matches clamp
        let headroom = liftedTop - safeTop
        let threshold = spaceInsufficient
            ? Self.minStableHeadroom + Self.crampedHideHysteresis
            : Self.minStableHeadroom
        let shouldHide = headroom < threshold
        if shouldHide != spaceInsufficient {
            VoiceLog.log("[capsule] space \(shouldHide ? "INSUFFICIENT → hide" : "recovered → show") (headroom=\(Int(headroom)) liftedTop=\(Int(liftedTop)) safeTop=\(Int(safeTop)))")
            withAnimation(.easeInOut(duration: 0.2)) { spaceInsufficient = shouldHide }
        }

        // Only track the lift while we actually have somewhere to put the button.
        // While hidden, leave `avoidLift` where it is (no re-lift churn) — the
        // button is faded out anyway, and freezing it avoids the very jitter we're
        // suppressing. It re-applies the settled value once space recovers.
        guard !shouldHide else { return }

        // [T-voice-capsule-streaming-ratchet] Ratchet with settle-window
        // descent. During a streaming reply the obstacle set under the capsule
        // genuinely oscillates at content rhythm (the FloatingToolBar preview
        // grows/swaps inside the "inputBar" composite, the scroll buttons pop
        // in and out) — each flip is slower than the 200/250ms debounces, so a
        // faithfully-tracking lift bounced the button ~80px up and down about
        // once a second (GH report, frame-tracked 590↔670px). Asymmetric
        // policy instead:
        //   rise: apply immediately — never let UI cover the button;
        //   fall: apply only after the LOWER target has held continuously for
        //         `descentSettleMillis`; any interim rise/return cancels the
        //         pending descent, so an oscillating obstacle pins the capsule
        //         at its high-water mark instead of dancing with it.
        let delta = newLift - avoidLift
        if delta > 6 {
            descentTask?.cancel()
            descentTask = nil
            VoiceLog.log("[capsule] APPLY lift \(Int(avoidLift)) → \(Int(newLift)) (rise); restingBottom=\(Int(rf.maxY)) → displayBottom=\(Int(rf.maxY - newLift))")
            avoidLift = newLift
        } else if delta < -6 {
            if allowDescent {
                descentTask = nil
                VoiceLog.log("[capsule] APPLY lift \(Int(avoidLift)) → \(Int(newLift)) (settled descent); restingBottom=\(Int(rf.maxY)) → displayBottom=\(Int(rf.maxY - newLift))")
                avoidLift = newLift
            } else if descentTask == nil {
                VoiceLog.log("[capsule] descent \(Int(avoidLift)) → \(Int(newLift)) ARMED — applying after \(Self.descentSettleMillis)ms of stability")
                descentTask = Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(Self.descentSettleMillis))
                    guard !Task.isCancelled else { return }
                    descentTask = nil
                    // Re-evaluate from a FRESH requiredLift at fire time — the
                    // world may have moved during the settle window.
                    recompute(allowDescent: true)
                }
            }
            // else: a descent is already pending — let it fire and re-evaluate.
        } else {
            // Target is back at (≈) the current lift — the obstacle returned.
            // A pending descent would undershoot; cancel it.
            if let t = descentTask {
                t.cancel()
                descentTask = nil
                VoiceLog.log("[capsule] descent CANCELLED — obstacle returned (lift stays \(Int(avoidLift)))")
            }
        }
    }

    private var control: some View {
        // Anchor both states bottom-trailing so the expand↔compact change is an
        // IN-PLACE size morph (the trailing edge stays put), not a move-to-corner.
        ZStack(alignment: .bottomTrailing) {
            if expanded {
                expandedCapsule
                    .transition(.scale(scale: 0.6, anchor: .bottomTrailing).combined(with: .opacity))
            } else {
                compactButton
                    .transition(.scale(scale: 0.6, anchor: .bottomTrailing).combined(with: .opacity))
            }
        }
        // Measure the base frame BEFORE the offset, and ONLY while not dragging, so
        // it never changes mid-drag (no measure↔render feedback → no flicker).
        .background(
            GeometryReader { geo in
                Color.clear.onChange(of: geo.frame(in: .global)) { f in
                    // Snapshot the real frame AND the offset that produced it, only
                    // while idle. The pair (baseFrame, baseFrameOffset) is a
                    // consistent reference; bounds are derived from it without ever
                    // re-subtracting the live offset (which double-counted before).
                    if !isDragging { baseFrame = f; baseFrameOffset = dragOffset }
                    // Restore the saved offset HERE (not in .onAppear): a
                    // background→foreground cycle rebuilds this View, resetting the
                    // @State dragOffset to .zero AND clearing any one-shot restore
                    // guard — the capsule jumped back to the default corner. Driving
                    // restore off the base-frame measurement guarantees baseFrame is
                    // valid (so clampedOffset actually clamps) and re-runs whenever
                    // the frame re-measures. Gated on `hasUserDragged` so a live drag
                    // this session is never overwritten; idempotent otherwise.
                    if !isDragging { restoreSavedPositionIfNeeded() }
                }
                .onAppear {
                    baseFrame = geo.frame(in: .global); baseFrameOffset = dragOffset
                    restoreSavedPositionIfNeeded()
                }
            }
        )
        // Pure @State offset, no implicit animation — drag tracks the finger 1:1.
        .offset(x: dragOffset.width, y: dragOffset.height)
        .onAppear {
            refreshModelLabel()
            if expanded { scheduleIdleCollapse() }
        }
        // First real utterance → collapse to compact.
        .onChange(of: state.isReadingAloud) { reading in
            if reading, expanded { setExpanded(false) }
        }
        // Fail-over switched the active model → update the capsule's model name.
        .onChange(of: voicePlayer.activeModelLabel) { _ in refreshModelLabel() }
        // Synthesis failed → flash the speaker red for 3 s, then restore.
        .onChange(of: voicePlayer.synthFailureTick) { _ in
            showFailureFlash = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { showFailureFlash = false }
        }
        .sheet(isPresented: $showModelSelector, onDismiss: { refreshModelLabel(); bumpIdle() }) {
            NavigationStack {
                UnifiedModelPicker(config: .voiceOutput())
            }
        }
    }

    @State private var isDragging = false
    /// True once the user has actively dragged THIS View instance's capsule.
    /// Guards the base-frame-driven restore so a live drag is never overwritten
    /// by a re-restore from UserDefaults. Reset (with the rest of @State) when
    /// the View is rebuilt after a background→foreground cycle — which is
    /// exactly right: after a rebuild there's no in-progress drag to protect, so
    /// restore should run again and re-apply the saved offset.
    @State private var hasUserDragged = false
    /// The offset that was in effect when `baseFrame` was last measured. Together
    /// they pin the control's real on-screen position regardless of later drags.
    @State private var baseFrameOffset: CGSize = .zero

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 3, coordinateSpace: .global)
            .onChanged { value in
                if !isDragging { isDragging = true; dragStart = dragOffset }
                hasUserDragged = true
                let raw = CGSize(width: dragStart.width + value.translation.width,
                                 height: dragStart.height + value.translation.height)
                dragOffset = clampedOffset(raw)
            }
            .onEnded { _ in
                isDragging = false
                bumpIdle()
                // Persist the drag offset RELATIVE to the resting corner (not an
                // absolute window coordinate) — valid in any window size, so the
                // capsule re-anchors correctly after rotation / Stage Manager
                // resizes. Only on release.
                VoiceOutputPreferences.capsuleAnchorOffset = dragOffset
                VoiceLog.log("[capsule] saved anchor offset=(\(Int(dragOffset.width)),\(Int(dragOffset.height)))")
            }
    }

    /// Clamp a proposed offset so the control stays within bounds. Uses the FIXED
    /// reference pair (baseFrame, baseFrameOffset) — the control's real resting
    /// top-left = baseFrame.origin − baseFrameOffset — so it never drifts no matter
    /// how often this is called or how large the offset grows.
    private func clampedOffset(_ proposed: CGSize) -> CGSize {
        guard baseFrame.width > 0 else { return proposed }
        let screen = Self.windowBounds()
        let m = Self.edgeMargin
        // Real resting top-left (offset removed via the offset that MADE this frame).
        let restLeft = baseFrame.minX - baseFrameOffset.width
        let restTop  = baseFrame.minY - baseFrameOffset.height
        let w = baseFrame.width, h = baseFrame.height

        let minX = m - restLeft
        let maxX = (screen.width - m - w) - restLeft

        let topInset = Self.safeAreaTopInset()
        let navBottom = topInset + 44 + 8
        let lowestTop = screen.maxY - bottomReserve - h
        let minY = navBottom - restTop
        let maxY = lowestTop - restTop

        return CGSize(
            width: min(max(proposed.width, min(minX, maxX)), max(minX, maxX)),
            height: min(max(proposed.height, min(minY, maxY)), max(minY, maxY))
        )
    }

    private static func safeAreaTopInset() -> CGFloat {
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first?.safeAreaInsets.top ?? 47
    }
    private static func safeAreaBottomInset() -> CGFloat {
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first?.safeAreaInsets.bottom ?? 34
    }

    /// The app WINDOW's bounds — NOT UIScreen. On iPad (Stage Manager / Split
    /// View) the window is smaller than the screen; every resting/clamp
    /// computation must use window space or the "resting corner" lands outside
    /// the visible window and the capsule floats mid-content.
    private static func windowBounds() -> CGRect {
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first?.bounds ?? UIScreen.main.bounds
    }

    /// Restore the saved dragged offset. IDEMPOTENT and safe to call on every
    /// base-frame measurement: it no-ops when the user has dragged this session
    /// or when the live offset already equals the saved value. The offset is
    /// RELATIVE to the bottom-trailing resting corner, so it is valid in any
    /// window size; the clamp pulls it inside the current bounds. Runs the clamp
    /// synchronously here because it's called from the geometry callback where
    /// `baseFrame` is already valid — no timing dependence on a deferred task.
    private func restoreSavedPositionIfNeeded() {
        guard !hasUserDragged, let saved = VoiceOutputPreferences.capsuleAnchorOffset else { return }
        // baseFrame must be measured for clampedOffset to do anything; if it
        // isn't yet, apply the raw saved offset and let the next measurement
        // callback clamp it.
        let target = baseFrame.width > 0 ? clampedOffset(saved) : saved
        guard abs(target.width - dragOffset.width) > 0.5
                || abs(target.height - dragOffset.height) > 0.5 else { return }
        VoiceLog.log("[capsule] restore anchor offset (\(Int(dragOffset.width)),\(Int(dragOffset.height))) → (\(Int(target.width)),\(Int(target.height)))")
        dragOffset = target
        scheduleRecompute()
    }

    /// Debounced re-clamp of the current drag offset into the CURRENT window
    /// bounds — runs after rotation / Stage Manager resize (and after restore),
    /// once the base frame has re-measured. Keeps the capsule inside the window
    /// the same way the scroll-to-bottom/top buttons stay layout-constrained.
    @State private var reclampTask: Task<Void, Never>?
    private func scheduleReclamp() {
        reclampTask?.cancel()
        reclampTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled, !isDragging else { return }
            let clamped = clampedOffset(dragOffset)
            if abs(clamped.width - dragOffset.width) > 0.5 || abs(clamped.height - dragOffset.height) > 0.5 {
                VoiceLog.log("[capsule] window-resize reclamp offset (\(Int(dragOffset.width)),\(Int(dragOffset.height))) → (\(Int(clamped.width)),\(Int(clamped.height)))")
                withAnimation(.easeInOut(duration: 0.2)) { dragOffset = clamped }
            }
            scheduleRecompute()
        }
    }

    private func setExpanded(_ v: Bool) {
        guard expandedState != v else { return }
        VoiceLog.log("[capsule] expanded → \(v)")
        withAnimation(.easeInOut(duration: 0.16)) { expandedState = v }
    }

    // MARK: - Compact

    /// The speaker icon, with a rotating 75°-arc loading ring around it while cloud
    /// TTS is synthesizing, and a brief RED tint when synthesis fails. `ring` is the
    /// diameter of the circular frame the spinner traces (the compact circle / the
    /// expanded button), so the arc hugs the icon's bounding circle in both states.
    @ViewBuilder
    private func speakerGlyph(size: CGFloat, ring: CGFloat) -> some View {
        // Muted → dimmed slashed speaker; otherwise active accent speaker.
        let tint: Color = showFailureFlash ? .red
            : (state.isMuted ? Color.secondary : Color.accentColor)
        Image(systemName: state.isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill")
            .font(.system(size: size, weight: .medium))
            .foregroundStyle(tint)
            .opacity(state.isMuted ? 0.55 : 1.0)
            .overlay {
                // Rotating 75° blue arc around the icon while synthesizing.
                if voicePlayer.isSynthesizing && !state.isMuted && !showFailureFlash {
                    RotatingArc(diameter: ring)
                }
            }
            .animation(.easeInOut(duration: 0.2), value: showFailureFlash)
    }

    private var compactButton: some View {
        ZStack(alignment: .bottomTrailing) {
            // No shadow — a faint border instead, matching the scroll-to-bottom pill.
            Circle()
                .fill(.ultraThinMaterial)
                .frame(width: 40, height: 40)
                .overlay(Circle().stroke(Color.gray.opacity(0.25), lineWidth: 0.5))
            speakerGlyph(size: 15, ring: 40).frame(width: 40, height: 40)
            if state.speechSpeed > 1.0 {
                Text(Self.speedLabel(state.speechSpeed))
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 4).padding(.vertical, 1)
                    .background(Capsule().fill(Color.accentColor))
                    .offset(x: 6, y: 4)
            }
        }
        .contentShape(Circle())
        // Double-tap toggles MUTE (temporary silence; capsule stays visible).
        .onTapGesture(count: 2) { state.isMuted.toggle() }
        // Single-tap always EXPANDS to the controls.
        .onTapGesture { setExpanded(true); bumpIdle() }
        .highPriorityGesture(dragGesture)
    }


    // MARK: - Expanded

    private var expandedCapsule: some View {
        HStack(spacing: 10) {
            // Pause / resume — on = blue speaker, off = dimmed muted-speaker.
            // Speaker = MUTE toggle (temporary silence; capsule stays visible).
            Button {
                state.isMuted.toggle(); bumpIdle()
            } label: {
                speakerGlyph(size: 15, ring: 28).frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)

            // Model chip (tap to switch the TTS model).
            Button {
                showModelSelector = true; bumpIdle()
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "waveform")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.secondary)
                    Text(modelLabel.isEmpty ? "Voice" : modelLabel)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundStyle(.tertiary)
                }
                .frame(maxWidth: 130)
            }
            .buttonStyle(.plain)

            // Speed chip (tap to cycle 1×→1.25×→1.5×→2×).
            Button {
                state.nextSpeed(); bumpIdle()
            } label: {
                Text(Self.speedLabel(state.speechSpeed))
                    .font(.caption2.weight(.bold))
                    .lineLimit(1)
                    .foregroundStyle(state.speechSpeed > 1.0 ? Color.accentColor : .secondary)
                    // Fixed width sized for the widest label ("1.25×") so cycling
                    // through speeds doesn't change the chip width (→ no jitter).
                    .frame(width: 34)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(Color.secondary.opacity(0.15)))
            }
            .buttonStyle(.plain)

            // Close (turn read-replies off).
            Button {
                state.disable()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.secondary)
                    .frame(width: 24, height: 24)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        // No shadow — a faint border instead, matching the scroll-to-bottom pill.
        .background(Capsule().fill(.ultraThinMaterial))
        .overlay(Capsule().stroke(Color.gray.opacity(0.25), lineWidth: 0.5))
        // Drag to reposition. Highest priority so the outer tap-to-dismiss layer
        // doesn't steal it.
        .highPriorityGesture(dragGesture)
    }

    // MARK: - Idle collapse

    private func bumpIdle() { scheduleIdleCollapse() }

    private func scheduleIdleCollapse() {
        idleCollapseToken &+= 1
        let token = idleCollapseToken
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.idleCollapseSeconds) {
            guard token == idleCollapseToken, expanded else { return }
            setExpanded(false)
        }
    }

    private func refreshModelLabel() {
        // Prefer the model that's ACTUALLY synthesizing (after a fail-over) so the
        // capsule reflects the live active model, not the configured default.
        modelLabel = voicePlayer.activeModelLabel ?? VoiceProviderResolver.outputModelLabel()
    }

    static func speedLabel(_ s: Float) -> String {
        if s == 2.0 { return "2×" }
        return "\(String(format: "%g", s))×"
    }
}

// MARK: - Synthesizing loading ring (rotating 75° arc)

/// A thin blue 75° arc traced on a `diameter`-wide circle, spinning continuously
/// while cloud TTS audio is being generated. Driven by `TimelineView(.animation)`
/// so it keeps spinning across compact↔expand morphs (no onAppear restart needed).
private struct RotatingArc: View {
    let diameter: CGFloat
    /// Arc length as a fraction of the full circle — 75° / 360° ≈ 0.208.
    private let arcFraction: CGFloat = 75.0 / 360.0
    /// Seconds per full revolution.
    private let period: Double = 0.9

    var body: some View {
        TimelineView(.animation) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            let angle = Angle(degrees: (t / period).truncatingRemainder(dividingBy: 1) * 360)
            Circle()
                .trim(from: 0, to: arcFraction)
                .stroke(Color.blue, style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                .frame(width: diameter, height: diameter)
                .rotationEffect(angle)
        }
    }
}
