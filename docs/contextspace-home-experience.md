# ContextSpace home experience

ContextSpace brings repositories, durable context, and the user's choice of AI into one workspace. The home screen expresses that promise as “Many repositories. One clear direction.” It retains the approved sunset palette and existing ContextSpace icon.

## Interaction conventions

- **Start work** creates a workspace; **Open workspace** enters an existing one. Keep these verbs consistent in navigation and empty states.
- Workspace search matches branch names, descriptions, and repository paths. The changes filter composes with search; clearing filters restores all workspaces.
- Repository chips at the bottom filter the workspace list and scroll back to it.
- **Launch into** explicitly names the workspace used by all assistant launch actions. Disable launch controls while any launch is pending or no workspace exists.
- **Jump to…**, also available with Command/Ctrl+K, searches workspaces and primary destinations. Arrow keys select, Enter opens, and Escape dismisses. A native modal dialog contains focus.
- Missing workspace status is pending, never clean. Assistant availability requires detection rather than an optimistic default.
- Overview status refresh runs on all three existing aliases: `/`, `/overview`, and `/dashboard`.

## Visual treatment

Use a spacious opening panel, concise workspace cards, subdued metrics, and a compact assistant rail. Reuse semantic light/dark tokens. Keep primary actions prominent; reserve motion for short entrances and directional hover feedback. Honor reduced-motion settings.

## Verification

The GUI production build and focused ESLint checks were run. Browser visual and interactive QA remains outstanding because this session exposes no available browser. Check both themes, narrow desktop widths, long workspace names, empty/search states, and keyboard focus before release.
