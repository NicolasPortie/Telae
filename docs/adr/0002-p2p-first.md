---
status: proposed
---

# Start with one-to-one P2P media and TURN fallback

The first Telae release supports one Sharer and one Viewer using a direct WebRTC Transport Path whenever ICE can establish it and TURN relay when it cannot. Multi-viewer streaming is deferred to an SFU milestone because a peer mesh multiplies the Sharer's upload cost and would make the initial quality and latency targets harder to reason about.

