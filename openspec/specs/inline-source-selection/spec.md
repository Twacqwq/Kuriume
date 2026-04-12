## ADDED Requirements

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

### Requirement: SourcePickerDialog is removed
The `SourcePickerDialog` component SHALL be removed. Episode clicks on the detail page SHALL navigate directly to the player page without opening a source selection dialog.

#### Scenario: Episode click navigates directly to player
- **WHEN** the user clicks an episode on the anime detail page
- **THEN** the app navigates to `/anime/$id/episode/$ep` without showing a dialog
- **THEN** the player page handles source selection internally

### Requirement: Auto-selection of optimal source
When entering the player page, the system SHALL automatically select the best available source without requiring user intervention.

#### Scenario: Returning user with history for this anime
- **WHEN** the user enters the player page for an anime they previously watched
- **THEN** the system selects the same provider, subtitle group, and resolution from their last session

#### Scenario: New user with no history
- **WHEN** the user enters the player page for an anime with no watch history
- **THEN** the system tries providers in order (Mikan → Nyaa → DMHY) and selects the first with available results
- **THEN** subtitle and resolution preferences from settings are applied

### Requirement: Switching source does not leave the player page
The user SHALL be able to switch provider, subtitle group, resolution, or episode without navigating away from the player page.

#### Scenario: Switching torrent provider
- **WHEN** the user taps a different provider tab (e.g., Nyaa)
- **THEN** the subtitle groups and resolutions update to reflect the new provider
- **THEN** playback restarts with the new source without page navigation

#### Scenario: Switching to online source
- **WHEN** the user taps the AGE online tab
- **THEN** the player switches from mpv torrent playback to HTML5 online playback (or vice versa)
- **THEN** this transition happens within the same page

#### Scenario: Switching episode
- **WHEN** the user taps a different episode number in the inline episode list
- **THEN** playback of the new episode begins without leaving the player page

### Requirement: Player page URL params simplified
The player page route SHALL accept only `t` (resume timestamp) and `onlineUrl` as optional search params. The params `groupId`, `resolution`, `subtitle`, and `provider` SHALL be removed from the URL.

#### Scenario: Direct navigation to player page
- **WHEN** a user navigates to `/anime/123/episode/3`
- **THEN** the page loads and auto-selects the best source without requiring URL search params

#### Scenario: Resume playback with timestamp
- **WHEN** a user navigates to `/anime/123/episode/3?t=120`
- **THEN** playback starts at 120 seconds
