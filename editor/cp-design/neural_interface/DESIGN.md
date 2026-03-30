# Design System Document: Digital Grit & HUD Precision

## 1. Overview & Creative North Star
### Creative North Star: "The Kinetic HUD"
This design system is engineered for professional-grade power. It moves away from the friendly, rounded "SaaS" aesthetic into a realm of raw, industrial precision. Inspired by high-fidelity military interfaces and neo-noir cinema, it treats the screen not as a webpage, but as a high-performance tactical console.

The visual signature is defined by **intentional rigidity**. By utilizing a 0px border-radius across the entire system, we create a sense of architectural permanence and "digital grit." The layout prioritizes information density and technical accuracy, using sharp edges and glassmorphism to imply a sophisticated, multi-layered data environment. This is a workspace for "power users" who command complex media streams.

---

## 2. Colors
Our palette is rooted in deep, charcoal voids to minimize eye strain during long editing sessions, punctuated by high-frequency neon accents that signal state changes and critical data.

### Palette Roles
*   **Neutral Core:** The foundation is `background` (#131313) and `surface_container_lowest` (#0e0e0e). These "ink blacks" provide the infinite depth required for neon light to pop.
*   **The Accents (Neon Energy):**
    *   **Primary (Electric Cyan):** `primary_container` (#00f3ff) for active states and critical navigation.
    *   **Secondary (Vivid Magenta):** `secondary_container` (#fe00fe) for creative overlays and specific media markers.
    *   **Tertiary (Acid Green):** `tertiary_container` (#bded00) for success states, rendering progress, and "system go" indicators.

### The "No-Line" Rule
Traditional 1px solid borders for sectioning are strictly prohibited. Layout boundaries must be defined through **Background Shift**. Use `surface_container_low` (#1c1b1b) against `background` (#131313) to create a panel. If a section needs to feel "embedded," use `surface_container_lowest`.

### Surface Hierarchy & Nesting
Treat the UI as a physical stack of glass sheets.
1.  **Level 0 (Base):** `surface` (#131313)
2.  **Level 1 (Panels):** `surface_container_low` (#1c1b1b)
3.  **Level 2 (Active Modules):** `surface_container_high` (#2a2a2a)
4.  **Floating HUDs:** Use `surface` at 60% opacity with a `backdrop-blur` of 20px to create a glassmorphic effect over the video preview or timeline.

---

## 3. Typography
The typographic strategy balances raw data (Monospaced) with aggressive, geometric structural headers.

*   **Display & Headlines:** Using **Space Grotesk**. Its wide apertures and geometric construction feel like high-tech labeling. `display-lg` should be used sparingly for "System Ready" or "Project Loaded" splash states.
*   **Body & Utility:** Using **Inter**. It provides the legibility required for complex property inspectors.
*   **The HUD Signature:** For all data readouts, timecodes, and file names, use `label-md` or `label-sm` with a monospaced variant of Inter or a dedicated mono font. This reinforces the feeling of a real-time computer readout.
*   **Hierarchy:** High contrast is key. Use `primary_fixed` (#6ff6ff) for labels that need immediate attention and `on_surface_variant` (#b9cacb) for secondary data.

---

## 4. Elevation & Depth
In this design system, "Elevation" is not about shadows; it is about **Light and Transparency**.

*   **The Layering Principle:** Depth is achieved by stacking the surface tiers. A `surface_container_highest` (#353534) card placed on a `surface_container_low` (#1c1b1b) background creates a "mechanical lift" without needing a drop shadow.
*   **Ambient Glow (Shadows):** Standard dark shadows are replaced by "Neon Bleed." When a panel is active, apply an extra-diffused outer glow using a 4% opacity of the `primary` (#e3fdff) color. This mimics the light emission of a futuristic screen.
*   **The "Ghost Border" Fallback:** If a container must be outlined (e.g., a selected video clip), use `outline_variant` (#3a494b) at 20% opacity. Never use 100% opaque lines.
*   **Glassmorphism:** All floating tooltips or modal overlays must use a semi-transparent `surface_bright` with a heavy backdrop-blur. This ensures the "raw power" of the content behind is never fully obscured.

---

## 5. Components

### Buttons
*   **Primary:** 0px radius. Background: `primary_container` (#00f3ff). Text: `on_primary_fixed` (#002022). High contrast, sharp edges.
*   **Secondary:** Ghost style. `outline` (#849495) border at 30% opacity. Hover state triggers a `primary` glow effect.
*   **Tertiary:** Text-only with monospaced `label-md` styling.

### Inputs & Property Inspectors
*   **Fields:** Use `surface_container_lowest` for the input well. The bottom border should be a 1px "Ghost Border" that illuminates to `primary_container` when focused.
*   **Monospace Data:** Values (numbers, hex codes) must always use monospaced styling for vertical alignment and technical feel.

### Cards & Lists
*   **Separation:** Strictly forbid divider lines. Use `0.4rem` (`spacing.2`) of vertical whitespace or a subtle shift from `surface_container_low` to `surface_container_lowest`.
*   **States:** An "active" list item should not just change color; it should gain a `secondary` (#ffabf3) left-edge "accent notch" (2px wide).

### Timeline Markers (Specialty)
*   **Playhead:** Use `primary` (#e3fdff) with a 2px vertical line and a glowing shadow to ensure it cuts through high-motion video content.
*   **Track Colors:** Use `secondary_fixed_dim` and `tertiary_fixed_dim` for clips to maintain a "muted neon" look that doesn't distract from the main preview.

---

## 6. Do's and Don'ts

### Do:
*   **Use 0px radius everywhere.** Consistency in sharp edges is what builds the "industrial" brand.
*   **Embrace the "Grit."** Use subtle noise textures or 10% opacity scanline overlays on large panels to simulate a high-tech hardware screen.
*   **Leverage Monospace.** Use it for any element that changes (time, file size, percentage).
*   **Prioritize Function.** In a video editor, the content is king. Ensure UI panels are "dimmed" (`surface_dim`) until hovered.

### Don't:
*   **Don't use rounded corners.** Even a 2px radius breaks the HUD immersion.
*   **Don't use standard drop shadows.** They feel like paper; we are building with light. Use glows or tonal shifts instead.
*   **Don't use "Friendly" language.** Keep UI labels technical and concise (e.g., use "INITIATE" instead of "Get Started").
*   **Don't use 1px solid borders for layout.** It clutters the interface and makes it look dated. Trust the tonal shifts to define space.