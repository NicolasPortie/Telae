# Telae — UI/UX Direction

## Product classification

Windows desktop utility for live screen viewing. The primary object is the shared picture itself; everything else exists to start, understand, or stop that experience.

## Visual direction: Projection Booth

Telae should feel closer to a focused projection/control-room tool than to a dashboard or a Discord clone. The shared picture sits on true black like a projection surface, while controls use neutral charcoal and a restrained tungsten-amber accent inspired by a projector lamp. Use clear Windows-native typography and precise controls. Avoid gradients, glass panels, card grids, decorative blobs, oversized marketing typography, and permanent sidebars.

### Tokens

- Video canvas: `#000000`
- App chrome: `#141412`
- Raised surface: `#1C1C19`
- Active surface: `#282721`
- Primary text: `#F1EFE8`
- Secondary text: `#9D9A90`
- Divider: `#313029`
- Signal accent: `#D8A85C`
- Danger: `#FF5D5D`
- Typography: Segoe UI Variable for the Windows-native product voice; tabular numerals for bitrate/latency statistics.
- Radius: 6 px for controls, 10 px for large media surfaces. Avoid rounding every container.
- Elevation: use border/contrast before shadow. Shadows only for floating overlays.
- Icons: Fluent System Icons or an equivalent coherent Windows-oriented set.

## Layout strategy

Use the **one big object** pattern.

### Home

Two things dominate the window: **Share screen** and the **friends list**. Friends are added by their six-character code and appear as Ao vivo when they are sharing; watching is one click, and switching to another live friend is available from the player. There is no invite code in the product. Recent sessions, servers, dashboards, and promotional content do not compete with those actions.

### Source picker

Show live thumbnails for displays and windows with strong selected state. System-audio inclusion and Quality Profile sit next to the confirmation action because they affect the resulting share.

### Sharer live view

Show a compact preview of exactly what is being sent, Viewer presence, connection-quality state, elapsed time, and a high-confidence **Stop sharing** action. Detailed WebRTC statistics stay behind a diagnostics disclosure.

### Viewer live view

The video surface consumes almost the entire window. Controls appear on pointer movement and fade after inactivity. Keep only playback volume, fit/fullscreen, quality status, connection state, and leave controls in the primary overlay.

## Interaction and motion

The motion personality is precise and premium, with quick feedback. The stream itself should never be visually disturbed for decorative animation.

- Hover feedback: 80–100 ms.
- Press feedback: 100–140 ms with subtle scale or surface shift.
- Panel/dialog entrance: 180–260 ms with decelerating easing.
- Exit: faster than entry.
- Use CSS transitions for simple state changes.
- Use GSAP only where a real timeline or coordinated sequence earns the dependency.
- Animate transform/opacity rather than layout properties.
- Respect `prefers-reduced-motion`.
- No ambient animation while a live video is playing.

## Anti-generic quality gate

Before accepting any screen, reject it if it contains any of these without a concrete product reason:

- centered hero copy inside the application;
- repeated generic cards;
- purple/blue gradient branding;
- glassmorphism across basic controls;
- excessive pills and rounded containers;
- decorative metrics that do not help diagnose streaming;
- three-column SaaS layouts;
- animation on every hover;
- icons used where plain text is clearer;
- UI state labels that disagree with the actual Share Session state machine.

