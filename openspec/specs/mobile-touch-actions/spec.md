## ADDED Requirements

### Requirement: Swipe to delete history entries on mobile
On mobile viewports, history list entries SHALL support a left-swipe gesture to reveal a delete action. The swipe SHALL require a minimum horizontal distance of 80px to activate, to avoid conflicts with system navigation gestures.

#### Scenario: Swiping left on a history entry
- **WHEN** the user swipes left on a history entry by at least 80px on a mobile viewport
- **THEN** a delete button is revealed on the right side of the entry

#### Scenario: Tapping the revealed delete button
- **WHEN** the user taps the revealed delete button
- **THEN** the history entry is deleted

#### Scenario: Swipe cancelled by vertical scroll
- **WHEN** the user begins a horizontal swipe but moves vertically by more than 10px
- **THEN** the swipe gesture is cancelled and normal scrolling continues

#### Scenario: Desktop hover delete unchanged
- **WHEN** the user hovers over a history entry on a desktop viewport
- **THEN** the existing hover-to-reveal delete button behavior is preserved

### Requirement: Long-press context menu on watchlist cards
On mobile viewports, watchlist cards SHALL support a long-press gesture (500ms) to display a context menu with options to change watch status and remove the item.

#### Scenario: Long-pressing a watchlist card
- **WHEN** the user presses and holds a watchlist card for 500ms on a mobile viewport
- **THEN** a context menu appears with options: change status (Unwatched, Watching, Completed) and Remove

#### Scenario: Selecting a status from context menu
- **WHEN** the user selects a status option from the context menu
- **THEN** the watchlist item's status is updated and the context menu closes

#### Scenario: Removing an item from context menu
- **WHEN** the user selects Remove from the context menu
- **THEN** the item is removed from the watchlist and the context menu closes

#### Scenario: Long-press cancelled by movement
- **WHEN** the user presses a watchlist card but moves their finger more than 10px before 500ms
- **THEN** the long-press is cancelled and no context menu appears

#### Scenario: Desktop hover actions unchanged
- **WHEN** the user hovers over a watchlist card on a desktop viewport
- **THEN** the existing hover-to-reveal action buttons are preserved
