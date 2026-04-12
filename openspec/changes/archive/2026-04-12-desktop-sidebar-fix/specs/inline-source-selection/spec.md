## MODIFIED Requirements

### Requirement: Source selection is inline on the player page
The player page SHALL display source provider tabs (Mikan, Nyaa, DMHY, AGE online), subtitle group chips, resolution chips, and an episode grid directly on the page without any modal dialog. This applies to all platforms (desktop and mobile). The source panel SHALL have an opaque background on all platforms so that content behind the application window is never visible through the panel.

#### Scenario: Player page shows inline source controls on mobile
- **WHEN** the user navigates to the player page on a mobile viewport
- **THEN** source tabs, subtitle group chips, resolution chips, and episode list are rendered below the video player in a vertical scroll layout

#### Scenario: Player page shows inline source controls on desktop
- **WHEN** the user navigates to the player page on a desktop viewport (≥md)
- **THEN** source tabs, subtitle group chips, resolution chips, and episode list are rendered in a sidebar panel beside the video player
- **THEN** the sidebar panel MUST have an opaque background (not transparent)

#### Scenario: Desktop source panel is opaque while player area is transparent
- **WHEN** the player page is displayed on desktop with the WebView background set to transparent for mpv rendering
- **THEN** the source panel aside SHALL render with an opaque background (`bg-background`)
- **THEN** the player area (left column) SHALL remain transparent so the native mpv view shows through
