---
status: accepted
---

# Use Chromium WebRTC before building a native media engine

Telaê will initially use Electron/Chromium for screen capture, WebRTC media transport, congestion control, codec negotiation, encryption, and decoding. A small CaptureAdapter seam keeps open the option of a future Windows-native capture/encode implementation if measured latency, quality, or resource usage proves Chromium to be the limiting factor; this avoids committing the first release to a custom C#/C++/Rust media pipeline before there is evidence that the added complexity is necessary.

