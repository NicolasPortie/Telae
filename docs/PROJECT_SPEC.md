# Telae — Project Spec

## Problem Statement

Watching something together through a friend's screen is useful, but general-purpose communication apps often mix screen sharing with channels, messaging, calls, communities, and account management. Telae focuses on the single job: select a screen or window, send a short invite, and let a friend watch it with excellent image quality, synchronized system audio, and latency low enough that interaction still feels immediate.

Literal zero latency is physically impossible because capture, encoding, network transit, decoding, and rendering all take time. The product goal is therefore low and stable glass-to-glass latency with graceful quality adaptation rather than buffering.

## Solution

Build a Windows desktop application with Electron, React, TypeScript, and Tailwind. Chromium's WebRTC stack handles capture, encoding, congestion control, encrypted media transport, and decoding. An ASP.NET Core signaling service coordinates Share Sessions and WebRTC negotiation but does not sit in the normal media path. Peers connect directly when possible and use TURN only when NAT or firewall conditions require a relay.

The first release is intentionally one Sharer to one Viewer. This keeps upstream bandwidth predictable, makes the latency target realistic, and gives the project a clean benchmark before adding multi-viewer delivery through an SFU.

## User Stories

1. As a Sharer, I want to choose a screen or application window, so that I control exactly what the Viewer can see.
2. As a Sharer, I want to include system audio, so that a Viewer can hear videos and other desktop content in sync with the picture.
3. As a Sharer, I want a short-lived invite, so that a friend can join without creating an account.
4. As a Sharer, I want to see when a Viewer is connecting, live, reconnecting, or gone, so that I always understand who is receiving my screen.
5. As a Sharer, I want to stop sharing instantly, so that capture ends when I expect it to.
6. As a Sharer, I want to choose an Auto, 720p, 1080p, or high-frame-rate Quality Profile, so that I can balance image quality and bandwidth.
7. As a Viewer, I want to join from an invite code or link, so that starting a session takes only a few seconds.
8. As a Viewer, I want the shared image to fill the available window cleanly, so that the content stays the focus.
9. As a Viewer, I want synchronized audio and video, so that films and other media remain watchable.
10. As a Viewer, I want the stream to adapt instead of pausing to buffer, so that poor network moments do not destroy the session.
11. As either participant, I want reconnect attempts to happen automatically after a brief network interruption, so that a transient drop does not require a new session.
12. As either participant, I want a clear connection-quality indicator, so that I can tell whether a problem comes from the network or the app.
13. As a developer, I want real WebRTC statistics exposed in a diagnostics view, so that quality and latency problems can be measured rather than guessed.
14. As a developer, I want the capture/transport behavior hidden behind a small application interface, so that a future native capture engine can replace Chromium capture without rewriting the product UI.

## Implementation Decisions

- Target Windows first.
- Use Electron for the desktop shell and Chromium WebRTC implementation.
- Use React + TypeScript + Tailwind for the visible application.
- Keep Electron `contextIsolation` enabled, renderer Node access disabled, and expose only narrow IPC capabilities through preload.
- Use ASP.NET Core with SignalR for signaling and Share Session presence.
- Keep signaling out of the media path after WebRTC negotiation.
- Use ICE with STUN and a production TURN service for NAT/firewall fallback.
- Use DTLS-SRTP provided by WebRTC for encrypted media transport and TLS/WSS for signaling.
- Begin with one Sharer and one Viewer. Multi-viewer delivery is a later SFU milestone.
- Prefer hardware-friendly H.264 for the first production codec path. AV1 can be introduced when both peers and the encoder path prove capable without increasing latency or CPU usage.
- Use Opus for transmitted audio and avoid voice-oriented audio processing on system-audio capture where the platform allows it.
- Treat capture, signaling, peer connection, quality control, and diagnostics as deep modules with small interfaces.
- Source selection is explicit per Share Session. Telae never starts sharing silently.
- Session invites expire and represent temporary access rather than permanent identity.
- DRM/HDCP-protected applications may intentionally block screen capture. Telae does not attempt to bypass those protections.

## Quality Targets

The targets below are product acceptance goals and must be validated on real Windows hardware and real networks.

| Metric | Initial target |
| --- | --- |
| Default visual target | 1080p60 when the sender, receiver, and network sustain it |
| Movie-oriented mode | Prefer stable resolution and A/V sync; 1080p30 is acceptable when 60 fps is unnecessary |
| LAN glass-to-glass latency | p95 <= 180 ms on supported hardware |
| Typical Internet glass-to-glass latency | p95 <= 400 ms when RTT and packet loss are within supported conditions |
| Join to first playable frame | <= 5 s p95 |
| Recovery after a brief connection interruption | <= 5 s when ICE recovery succeeds |
| Audio/video sync error | Keep perceptually aligned; measure drift during endurance tests |
| Playback behavior under congestion | Reduce quality before introducing long buffering |

## Testing Decisions

- Test domain behavior through the highest useful module seam rather than internal implementation details.
- Unit-test the Share Session state machine and Quality Profile decisions.
- Integration-test signaling with two real clients and verify offer/answer, trickle ICE, leave, and reconnect behavior.
- End-to-end-test two Electron instances using deterministic synthetic media where practical.
- Add a Windows media benchmark that records WebRTC `getStats()` data for bitrate, RTT, packet loss, jitter, frames encoded/decoded/dropped, candidate type, and available outgoing bitrate.
- Validate quality on at least integrated Intel/AMD graphics and a discrete NVIDIA/AMD class GPU before calling 1080p60 production-ready.
- Run long sessions to detect A/V drift, memory growth, encoder degradation, and reconnection failures.

## Out of Scope

- Remote mouse/keyboard control.
- Text chat, communities, channels, bots, or a Discord-style social layer.
- Recording or cloud VOD.
- More than one Viewer in the first release.
- macOS, Linux, mobile, and browser-only clients in the first release.
- DRM or HDCP bypass.
- Custom video codecs or a custom congestion-control algorithm.

## Further Notes

The initial architecture intentionally uses Chromium's mature media stack instead of implementing capture, codecs, RTP, congestion control, and NAT traversal from scratch. If measured performance later proves insufficient, the desktop application retains the same product surface while a native media adapter can replace only the capture/encode path.

