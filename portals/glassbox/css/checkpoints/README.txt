# Tool layout checkpoint — 2026-08-03 (pre-redesign)

This folder is the restore point for the Glass Box tool chrome
(Instructions / Workspace tiles) before the visual redesign.

## Revert CSS (usual case)

From this folder:

```
Copy-Item -LiteralPath ".\portal.full-2026-08-03-pre-tool-redesign.css" -Destination "..\portal.css" -Force
```

Then hard-refresh the portal.

## Revert JS shells (only if markup changes need undoing)

```
Copy-Item -LiteralPath ".\file-ui.2026-08-03-pre-tool-redesign.js" -Destination "..\..\Scripts\_shared\file-ui.js" -Force
Copy-Item -LiteralPath ".\tool-shell.2026-08-03-pre-tool-redesign.js" -Destination "..\..\Scripts\_shared\tool-shell.js" -Force
Copy-Item -LiteralPath ".\tool-loader.2026-08-03-pre-tool-redesign.js" -Destination "..\..\js\tool-loader.js" -Force
```
