export const CHANGELOG_TEXT = `Version 1.1.2 (Web)
- Hub greeting (“Welcome {name}!”); Choose Portal shows Insights and Glass Box only.
- Renamed Geographic to States. Added Cities (origin and destination, city + state).
- Renamed Filters to Focuses. Add Focus builder: parent category → child layer → pick values from the full dump. Active focuses sit in a table with delete. Multiple focuses stack (AND across fields, OR on the same field). Clear focus is red.
- Removed click-to-focus on tables and the unused date range box.
- Change log, Focuses, and other views are usable before an upload. Leaving Insights clears the last dump so the next visit starts clean.

Version 1.1.1 (Web)
- Accessorials → By month: multi-select filters for accessorial type and customer; Calculate by Invoice Date or Ship Date (ACTUAL SHIP DATE).

Version 1.1.0 (Web)
- Renamed product to Dalko Insights.
- Large-file hardening: size/row limits with confirmations, background parse + analyze workers, cancellable jobs, progress detail on the loading overlay, main-thread fallbacks if workers fail.

Version 1.0.2 (Web)
- Initial web version: local Excel upload, in-browser analytics, dark dashboard UI.

Version 1.0.2 (Desktop)
- Adjusted the start up process so that the program opens full screen by default and the Dashboard tab is the active tab.

Version 1.0.1
- Removed the Territory tab and replaced it with a Division and Office breakdown. Both are focusable.
- Added a PDF export option to the main dashboard page. This is a work in progress and is subject to change.
- Added a change log tab. You Are Here!

Version 1.0.0
- Initial release of the dashboard. Branding and naming is to be determined.`;
