# Telae — Implementation Plan

The work is split into tracer-bullet slices: each ticket produces behavior that can be demonstrated end to end.

## 01 — Select and preview a Capture Source

**Blocked by:** None.

**Delivers:** A packaged Electron development shell in which the Sharer can select a display or window, optionally include supported system audio, see a local preview, and stop capture reliably.

Acceptance:

- Capture starts only after an explicit selection.
- Closing/stopping capture releases every media track.
- Renderer is isolated from Node and uses a narrow preload interface.
- The preview can sustain the initial 1080p target on a reference Windows machine without UI jank.

## 02 — Create and join a Share Session

**Blocked by:** 01.

**Delivers:** ASP.NET Core signaling plus desktop UI for generating a short-lived invite and joining it from a second running app instance.

Acceptance:

- Sharer sees `waiting-for-peer`, `negotiating`, and disconnect states from one state model.
- Invalid/expired invites fail with a specific user-facing reason.
- Session presence reconnects within a bounded window after a signaling socket drop.

## 03 — Stream video directly between two peers

**Blocked by:** 02.

**Delivers:** The selected Capture Source renders live in the Viewer app over a direct WebRTC connection.

Acceptance:

- SDP and trickle ICE negotiation work between two Windows clients.
- Media flows peer-to-peer when a direct ICE candidate succeeds.
- Viewer sees first video frame within the join target on the reference network.
- Leaving from either side tears down peer connection and capture deterministically.

## 04 — Add synchronized system audio

**Blocked by:** 03.

**Delivers:** Desktop/system audio travels with the video and stays perceptually synchronized during normal and long sessions.

Acceptance:

- Viewer receives stereo system audio from supported Windows capture paths.
- Voice-processing constraints are not applied to system audio unless required by the platform.
- A/V sync is sampled in short and endurance tests.
- Missing/unsupported loopback audio is reported clearly instead of silently producing an audio-less stream.

## 05 — Quality Profiles and live adaptation

**Blocked by:** 03.

**Delivers:** Auto, 720p, 1080p30, and 1080p60 profiles, plus measured bitrate adaptation that prioritizes continued low-latency playback.

Acceptance:

- QualityController owns bitrate/resolution/fps sender decisions.
- Congestion reduces transmitted quality before introducing a long buffer.
- Diagnostics reports active resolution, fps, bitrate, RTT, loss, jitter, codec, and candidate path.
- 1080p60 is enabled only when benchmark evidence says the current path sustains it.

## 06 — TURN fallback across restrictive networks

**Blocked by:** 03.

**Delivers:** A Share Session still connects when direct peer connectivity is unavailable.

Acceptance:

- TURN relay is selected automatically after direct-path failure.
- UI can distinguish Direct and Relay Transport Paths without exposing WebRTC jargon by default.
- TURN credentials are short-lived.
- Relay behavior passes the same teardown and reconnect tests as direct mode.

## 07 — Reconnect and resilience

**Blocked by:** 04, 05, 06.

**Delivers:** Short network interruptions recover automatically without asking users to recreate the session.

Acceptance:

- ICE restart is attempted for recoverable failures.
- Reconnect has a finite retry budget and ends in a clear terminal state.
- Media resumes without duplicate tracks or leaked connections.
- The app survives sleep/wake and common network-interface changes as defined by the supported matrix.

## 08 — Product UI pass

**Blocked by:** 05, 07.

**Delivers:** The Projection Booth experience for Home, source picker, Sharer live view, Viewer live view, settings, errors, and diagnostics.

Acceptance:

- UI follows the one-big-object layout and anti-generic quality gate.
- Live Viewer mode gives maximum area to the shared picture.
- All state copy maps to the canonical Share Session vocabulary.
- Keyboard navigation, focus states, reduced motion, and sensible hit areas are present.
- Motion stays within the defined duration palette and does not compete with live media.

## 09 — Security and privacy hardening

**Blocked by:** 02, 07.

**Delivers:** A release configuration that makes unintended capture, renderer privilege escalation, and stale session access materially harder.

Acceptance:

- Electron security baseline is enforced in production config.
- Capture permissions and session expiry have end-to-end tests.
- Stale invites cannot rejoin ended sessions.
- Unexpected renderer/main-process termination stops or invalidates the affected Share Session.

## 10 — Release benchmark and Windows packaging

**Blocked by:** 08, 09.

**Delivers:** Installable Windows builds plus a repeatable quality report for the release candidate.

Acceptance:

- Signed/packaged app starts cleanly on the supported Windows matrix.
- Two-machine benchmark records glass-to-glass latency, join time, bitrate, packet loss, dropped frames, CPU/GPU load, and A/V drift.
- Direct and TURN paths are benchmarked independently.
- Quality Targets in the spec are either met or updated with measured evidence before release.

## Later milestones

After the one-to-one product is stable, evaluate a real multi-viewer requirement. If needed, add an SFU as a new PeerTransport adapter rather than creating a mesh. Native Windows capture/encoding should likewise be introduced only if benchmark data shows Chromium is the limiting factor.

