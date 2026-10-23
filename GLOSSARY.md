# Telaê

Telaê is a Windows desktop screen-sharing product focused on watching a friend's screen with high visual quality and very low latency.

## Language

**Share Session**:
A temporary live connection in which one person shares a capture source and another person watches it.
_Avoid_: Room, call, meeting

**Sharer**:
The person whose screen or application is being transmitted during a Share Session.
_Avoid_: Host, streamer, broadcaster

**Viewer**:
The person watching the Sharer's transmitted content during a Share Session.
_Avoid_: Guest, receiver, client

**Capture Source**:
A screen or application window explicitly selected by the Sharer for transmission.
_Avoid_: Stream, feed

**Quality Profile**:
A user-facing target for transmitted resolution and frame rate, such as 1080p60, which may adapt downward when the connection cannot sustain it.
_Avoid_: Quality level, preset

**Transport Path**:
The network route used by the encrypted media: Direct when peers can reach each other, or Relay when TURN is required.
_Avoid_: Connection type, server mode

**Live State**:
The period in which the Viewer is actively receiving playable media from the Sharer.
_Avoid_: Connected state, streaming state

**Account**:
A person's identity in Telaê: email, password and a unique @username. Friendships and sessions belong to the account, not to a computer.
_Avoid_: Profile, device

**Friend**:
Another account that has added you back. Only mutual friends can watch each other's Share Sessions.
_Avoid_: Contact, follower
