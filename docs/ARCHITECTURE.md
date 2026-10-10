# Telae — Architecture

## System shape

```text
┌────────────────────────── Sharer / Windows ──────────────────────────┐
│ Electron                                                       │
│  React UI                                                      │
│     │                                                          │
│  StreamController                                              │
│     ├─ CaptureAdapter ── Chromium screen/window + loopback audio│
│     ├─ PeerTransport ─── WebRTC RTCPeerConnection              │
│     ├─ QualityController                                       │
│     └─ Diagnostics                                             │
└──────────────────────────────┬──────────────────────────────────┘
                               │ encrypted media
                     Direct P2P│        │TURN relay fallback
                               ▼        ▼
┌────────────────────────── Viewer / Windows ──────────────────────────┐
│ Electron + React                                                   │
│  PeerTransport ──> Playback surface ──> Diagnostics                │
└─────────────────────────────────────────────────────────────────────┘

                ▲                                   ▲
                └──────── SignalR / WSS ────────────┘
                          ASP.NET Core
                    Share Session signaling
```

The ASP.NET Core service coordinates presence, short-lived invite tokens, SDP descriptions, and ICE candidates. Media should not traverse this service after negotiation.

## Why this stack

Electron is useful here for more than UI. Chromium already ships a production WebRTC stack with RTP/RTCP, DTLS-SRTP, ICE, congestion control, jitter handling, codec negotiation, hardware acceleration hooks, and media statistics. Rebuilding that media plane in C# would dramatically increase scope before the product has proved it needs a custom engine.

C# remains a strong choice for the signaling backend because the backend does not need to process frames. ASP.NET Core + SignalR gives simple session groups, reconnect semantics, WebSocket transport, and a stack already familiar to the project's developer.

## Deep modules

### StreamController

Owns the complete lifecycle of sharing. Its public interface should stay close to:

- start a Share Session from a Capture Source and Quality Profile;
- stop the Share Session;
- observe a small state model and diagnostics snapshot.

The renderer should not coordinate raw WebRTC steps itself.

### CaptureAdapter

Produces a media stream from an explicitly selected Capture Source. The first adapter uses Electron/Chromium screen capture and Windows loopback/system audio when supported.

This seam exists because capture and hardware encoding are the most likely parts to need a future native implementation. A later adapter may use Windows Graphics Capture/WASAPI plus a native media bridge without changing the rest of the application.

### PeerTransport

Owns `RTCPeerConnection`, SDP negotiation, ICE candidates, track attachment, teardown, and ICE restart. The rest of the product should see connection states and media events rather than browser negotiation details.

### SignalingClient

Owns the SignalR connection and maps transport messages to Share Session events. It does not own media state.

### QualityController

Maps a user Quality Profile plus live network/encoder statistics into sender parameters. It can adjust bitrate and, when supported by the active browser path, degradation preference without forcing the UI to understand WebRTC internals.

### Diagnostics

Samples WebRTC statistics on a fixed cadence and emits a compact snapshot including bitrate, RTT, jitter, packet loss, frames, codec, selected candidate pair, and Transport Path.

## Share Session state model

```text
idle
  └─> preparing
       └─> waiting-for-peer
            └─> negotiating
                 └─> live
                      ├─> reconnecting ──> live
                      └─> ended

Any pre-live state ──> ended
reconnecting ────────> ended when recovery budget expires
```

State changes should be driven by actual signaling and peer-connection events. The UI renders this model; it does not invent parallel connection state.

## Media strategy

### Video

- Default to H.264 first because Windows machines commonly have efficient hardware paths and interoperability is strong.
- Add AV1 later behind capability and benchmark gates. Better compression is useful only if encode/decode time and CPU/GPU cost stay acceptable.
- Use a motion-oriented capture hint for films/games and a detail-oriented hint for text-heavy sharing when supported.
- Use `RTCRtpSender.setParameters()` for bitrate ceilings and adaptation controls rather than repeatedly rebuilding the peer connection.
- Never use a long playback buffer to hide poor network conditions. Reduce quality first.

Suggested starting ceilings for lab tuning, not hard guarantees:

| Profile | Starting ceiling |
| --- | ---: |
| 720p60 | 4–6 Mbps |
| 1080p30 | 5–8 Mbps |
| 1080p60 | 8–12 Mbps |
| 1440p60 experimental | 12–20 Mbps |

These values must be replaced by benchmark evidence as the controller matures.

### Audio

- Capture system audio/loopback together with the selected visual source where Electron/Windows supports it.
- Use Opus through WebRTC.
- Disable microphone-oriented processing such as echo cancellation/noise suppression for pure system audio where constraints allow it.
- Treat A/V drift as a release metric and test it over long sessions.

## Connectivity

ICE gathering uses STUN to discover viable direct paths. If direct connectivity fails, TURN relays the already encrypted WebRTC traffic. TURN is therefore a required production dependency even though most ideal sessions should remain direct.

The Viewer must never need inbound port forwarding.

## Security baseline

- `contextIsolation: true`.
- `nodeIntegration: false` in renderer windows.
- Electron sandbox enabled where compatible with required APIs.
- Narrow, typed preload IPC surface.
- Strict Content Security Policy.
- TLS for signaling and TURN credentials with short lifetimes.
- Share Session invite tokens are high-entropy and expire.
- A Viewer joining a session becomes visible to the Sharer before media is considered live.
- Capture stops when the Share Session ends or the app exits unexpectedly.

## Backend responsibilities

The ASP.NET Core service owns:

- create/join/leave Share Session commands;
- ephemeral invite validation;
- SignalR grouping;
- SDP and ICE candidate forwarding;
- presence and reconnect window;
- TURN credential issuance if ephemeral TURN credentials are used;
- coarse operational metrics.

It does not decode, transcode, record, or inspect normal media frames.

## Multiple viewers

The current implementation supports up to 12 Viewers per Share Session. Each Viewer has an independent WebRTC connection, an Auto quality controller and a recovery budget of three ICE restarts, with a ten-second deadline per attempt. A failed Viewer does not end healthy Viewer connections. Diagnostics show total video upload and network quality from the worst sampled connection.

The Sharer captures one source but sends media separately to each Viewer. Upload and encoding cost therefore grow with the Viewer count; 12 is an admission limit, not a measured guarantee of 1080p60 on every machine. An SFU remains a future transport option if one upstream is needed.

The desktop exposes a total video upload ceiling (40 Mbps by default, configurable from 2 to 200 Mbps). Each peer receives a share of that ceiling; audio, protocol overhead and brief negotiation transitions are additional traffic. Text mode prioritizes resolution; motion mode prioritizes frame rate and may downscale. Measured encoder CPU pressure also reduces quality. Quality and audio mute can be changed without recreating the session. Removing a Viewer revokes its access for the remaining lifetime of that session, including when it reuses the same invite.

A Viewer is marked live only after the playback element confirms a presented frame. A connected transport without displayed video retains a bounded recovery deadline. Audio diagnostics distinguish an available track from receiving packets; silence is not itself a transmission failure. The process-audio worklet keeps at most 120 ms of PCM in a fixed ring buffer and reports discarded frames and underruns.

Diagnostic exports use an explicit allowlist without invite codes, identities or session identifiers. They retain up to one hour of structured samples, bounded state/error-category history and aggregates covering all collected samples. Actual glass-to-glass latency and perceptual A/V drift still require the physical benchmark.

## Device credentials and migration

Each desktop stores a random 256-bit device credential locally. Registration requires it; the server persists only its SHA-256 hash and compares credentials in constant time. Device IDs and friend codes are public identifiers and do not authorize registration or joining.

Friend joins (`JoinFriendShare`) require mutual friendship: each device must have declared the other through `GetFriends`. Declaring someone notifies them (`FriendRequestReceived`) when online; pending requests are listed via `GetFriendRequests` and can be accepted by declaring back or dismissed via `DismissFriendRequest` (a dismissal expires if the requester removes and re-adds). Declarations persist across reconnects and change only when the device sends a new list. When mutual friendship stops holding for an active viewer, the viewer is removed from that session and both participants are notified (`SessionEnded` / `ViewerLeft`). Switching to another friend is a single server operation: if the server refuses it, the current session is kept. Legacy `CreateInvite` / `JoinWithInvite` exist only for clients up to 0.1.20; the current desktop never creates or shows invites. Direct `JoinShare` is restricted to Viewers already authorized for that active session; leaving revokes that authorization. Signaling remains restricted to the Sharer/Viewer pair.

Presence is delivered only to registered connections subscribed to known friend codes through `GetFriends`. Each subscription request replaces the prior set, including an empty set; reconnecting clients restore their subscriptions. Public identifiers do not grant access to media. Hub commands enforce input sizes and separate budgets for registration, commands and ICE signaling.

TURN configuration is checked at startup. The health endpoint reports whether relay credentials are configured without returning secrets or claiming verified connectivity. Real relay validation forces the ICE relay policy and checks the selected candidate pair. See [release validation](RELEASE_VALIDATION.md).

Desktop profiles without credentials migrate to a new device ID and credential, preserving the display name and saved friend codes. Legacy server profiles cannot be claimed by supplying an arbitrary new credential. Coordinate the backend and desktop update; pre-0.1.12 clients must update before registering against the secured backend.

Capture and peer connections are stopped locally before remote leave/stop notification. Pending capture initialization is cancellable, and the captured video track ending also ends the session. Audio bridge messages and cleanup are scoped by capture ID, including when two windows belong to the same process. Profiles are written to a temporary file, flushed and atomically replaced on both the server and desktop.

