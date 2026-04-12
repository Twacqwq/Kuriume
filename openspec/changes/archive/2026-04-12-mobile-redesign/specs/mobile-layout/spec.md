## ADDED Requirements

### Requirement: Mobile grid uses 2 columns
The home page, watchlist, and calendar grids SHALL render in 2 columns on viewports below the `md` breakpoint (768px). Each card SHALL have sufficient width (~166px at 375px viewport) to display readable cover art and un-truncated titles.

#### Scenario: Home page grid on 375px viewport
- **WHEN** the viewport width is 375px
- **THEN** the anime grid renders 2 columns with approximately 166px card width and 12px gap

#### Scenario: Grid columns at md breakpoint
- **WHEN** the viewport width is 768px or greater
- **THEN** the anime grid renders 4 or more columns (existing desktop behavior unchanged)

### Requirement: Hero banner mobile height reduction
The hero banner on mobile SHALL have a maximum height of h-40 (160px), reduced from h-52 (208px).

#### Scenario: Banner height on mobile
- **WHEN** the viewport is below the md breakpoint
- **THEN** the hero banner renders at 160px height

### Requirement: Bottom tab bar includes History
The bottom tab bar SHALL display 5 tabs: Home, Calendar, Watchlist, History, Me. The Search tab SHALL be removed from the bottom tab bar.

#### Scenario: Tab bar layout on mobile
- **WHEN** the app is displayed on a mobile viewport (below md)
- **THEN** the bottom tab bar shows tabs for Home (/), Calendar (/calendar), Watchlist (/watchlist), History (/history), and Me (/me)

#### Scenario: Search not in tab bar
- **WHEN** the user views the bottom tab bar
- **THEN** there is no Search tab in the tab bar

### Requirement: Search bar on home page
The home page SHALL display a search input bar at the top of the page on mobile viewports. Tapping the search bar SHALL open the full-screen search panel.

#### Scenario: Tapping search bar opens search panel
- **WHEN** the user taps the search bar on the mobile home page
- **THEN** the full-screen search panel opens with the keyboard active

### Requirement: Detail page horizontal hero on mobile
On mobile viewports, the anime detail page hero section SHALL render the cover image and metadata side-by-side in a horizontal layout, with the cover at approximately 80×120px. Episodes SHALL be visible on the first screen without scrolling.

#### Scenario: Detail hero layout on mobile
- **WHEN** the user opens an anime detail page on a mobile viewport
- **THEN** the cover image and title/metadata are displayed side-by-side (horizontal flex)
- **THEN** the episode list is visible without scrolling past the hero section

#### Scenario: Detail hero layout on desktop
- **WHEN** the user opens an anime detail page on a desktop viewport (≥md)
- **THEN** the existing vertical/large hero layout is preserved

### Requirement: Me page shows continue watching
The Me page SHALL display a "Continue watching" section showing recent watch history entries with progress bars and a resume play button.

#### Scenario: Continue watching with history
- **WHEN** the user navigates to the Me page and has watch history
- **THEN** the page displays up to 3 recent history entries with cover thumbnails, episode info, progress bars, and a resume play button

#### Scenario: Settings accessible from Me page
- **WHEN** the user is on the Me page
- **THEN** a Settings menu item is directly visible without nested navigation

### Requirement: Calendar page uses 2-column grid on mobile
The calendar page SHALL render anime cards in a 2-column grid on mobile viewports.

#### Scenario: Calendar grid on mobile
- **WHEN** the viewport is below md breakpoint
- **THEN** the calendar anime grid renders in 2 columns

### Requirement: Watchlist page uses 2-column grid on mobile
The watchlist page SHALL render anime cards in a 2-column grid on mobile viewports.

#### Scenario: Watchlist grid on mobile
- **WHEN** the viewport is below md breakpoint
- **THEN** the watchlist anime grid renders in 2 columns
