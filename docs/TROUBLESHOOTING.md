# Troubleshooting

## Toast Notifications

Ralph uses [react-hot-toast](https://react-hot-toast.com/) for all user-facing notifications. The `<Toaster>` component is mounted once in `AppShell.tsx` and every toast is triggered through the centralized `toastService` at `src/renderer/services/toastService.ts`.

---

### Z-Index Architecture

All overlay layers follow a strict stacking contract. Violating this order is the #1 cause of "invisible" toasts.

```
┌─────────────────────────────────────────────────────┐
│                 VIEWPORT (z: auto)                  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  UModal .backdrop            z-index: 1000    │  │
│  │  DiscoveryView .resumeOverlay z-index: 1000   │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │  UModal .dialog           z-index: 1001 │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  ULogViewer .viewer.fullscreen z-index: 9990  │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  Toaster container (react-hot-toast)          │  │
│  │  containerStyle={{ zIndex: 10000 }}           │  │
│  │  position: fixed  ·  pointer-events: none     │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │  Individual toast bars                  │  │  │
│  │  │  pointer-events: auto                   │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  TOPMOST ──────────────────────────── z: 10000      │
│                                                     │
│  fullscreen log viewer ──────────── z: 9990         │
│                                                     │
│  modal dialog ───────────────────── z: 1001         │
│  modal backdrop / discovery overlay  z: 1000        │
│                                                     │
│  BOTTOMMOST ─────────────────────── z: auto         │
└─────────────────────────────────────────────────────┘
```

**Source files governing z-index:**

| Layer | Value | File | Selector / Prop |
|---|---|---|---|
| Toast container | `10000` | `src/renderer/components/AppShell/AppShell.tsx` | `containerStyle={{ zIndex: 10000 }}` |
| Log viewer fullscreen | `9990` | `src/renderer/components/ui/ULogViewer.module.css` | `.viewer.fullscreen` |
| Modal dialog | `1001` | `src/renderer/components/UModal/UModal.module.css` | `.dialog` |
| Modal backdrop | `1000` | `src/renderer/components/UModal/UModal.module.css` | `.backdrop` |
| Discovery resume overlay | `1000` | `src/renderer/views/DiscoveryView.module.css` | `.resumeOverlay` |
| Log viewer scroll indicator | `1` | `src/renderer/components/ui/ULogViewer.module.css` | `.scrollIndicator` |

**Invariant:** `toast (10000) > fullscreen log (9990) > modal dialog (1001) >= modal backdrop (1000) > page content (auto)`

This invariant is enforced at test time by `tests/unit/toast-zindex.test.ts`.

---

### How to Verify Toasts Are Working

#### Quick manual check

1. Open DevTools in the Electron window (`Ctrl+Shift+I`).
2. In the Console, run:
   ```js
   // react-hot-toast is available via the AppShell-mounted Toaster
   const { default: toast } = await import("react-hot-toast");
   toast.success("Manual test toast");
   ```
3. A green-bordered toast should appear in the **bottom-right** corner.

#### Verify the Toaster container exists

1. In DevTools → Elements, search for `[data-rht-toaster]`.
2. The element should be `position: fixed` with `z-index: 10000` and `pointer-events: none`.
3. If this element is missing, the `<Toaster>` component is not mounting — check that `AppShell.tsx` renders it.

#### Run the automated tests

```bash
# Unit tests — parse source files to validate z-index values
npx vitest run tests/unit/toast-zindex.test.ts

# E2E tests — validate in real Electron runtime
npx playwright test tests/e2e/toast-visibility.e2e.ts
```

---

### Common Failure Modes

#### 1. Toasts render but are invisible (hidden behind an overlay)

**Symptom:** `toastService.success()` returns a toast ID (not `undefined`), but nothing appears on screen. Happens most often when the ULogViewer is in fullscreen mode or a modal is open.

**Root cause:** Another element has a `z-index` equal to or higher than the Toaster container's `z-index`.

**How to diagnose:**
1. Open DevTools → Elements → find `[data-rht-toaster]`.
2. Check its computed `z-index`. It must be `10000`.
3. Look at overlapping elements. Any element with `z-index >= 10000` and `position: fixed/absolute` will occlude toasts.

**Fix:** Lower the offending element's z-index below `10000`. Never raise the Toaster above `10000` — fix the other side. Update the stacking table above and the unit test if values change.

#### 2. Toaster container is missing from the DOM

**Symptom:** `document.querySelector('[data-rht-toaster]')` returns `null`.

**Root cause:** The `<Toaster>` component in `AppShell.tsx` is not rendering. This can happen if:
- `AppShell.tsx` has a render error above the `<Toaster>` line (React bails out of the entire tree).
- `react-hot-toast` failed to import or initialize.

**How to diagnose:**
1. Check the DevTools Console for React errors.
2. Confirm `react-hot-toast` is in `node_modules/` and the import in `AppShell.tsx` resolves.
3. Add a temporary `console.log` before the `<Toaster>` JSX to confirm the component reaches that point.

**Fix:** Resolve the render error or reinstall `react-hot-toast` (`npm install react-hot-toast`).

#### 3. Toasts fire but immediately disappear

**Symptom:** A brief flash of the toast, then it vanishes before the configured duration.

**Root cause:** Something is calling `toast.dismiss()` or the component tree re-mounts (destroying the Toaster state).

**How to diagnose:**
1. Search for `toast.dismiss` or `toast.remove` calls in the codebase.
2. Check React Strict Mode — in development, Strict Mode double-mounts components. react-hot-toast handles this, but custom wrappers around it may not.
3. Check if navigation (React Router) is unmounting and remounting `AppShell`.

**Fix:** Ensure `AppShell` is a layout route that persists across navigation (it uses `<Outlet />`). If a specific `dismiss()` call is too aggressive, scope it or remove it.

#### 4. Toasts appear but with wrong styling

**Symptom:** Toasts display but look unstyled (white background, default font) or have the wrong border color.

**Root cause:** The `toastOptions.style` block in `AppShell.tsx` is being overridden, or the per-type overrides (`success.style`, `error.style`) were removed.

**How to diagnose:**
1. Inspect the toast element in DevTools. Check its inline styles.
2. Compare against the expected values in `AppShell.tsx` lines 188-211.

**Fix:** Restore the `toastOptions` configuration in the `<Toaster>` component. The canonical styling is:
- Background: `#1a1a1a`
- Text: `#e6e6e6`
- Border: `2px solid #d97706` (amber, default)
- Success border: `#15803d`
- Error border: `#b91c1c`
- Font: Space Grotesk, 600 weight, 0.875rem
- Shadow: `4px 4px 0 #000` (brutalist offset)

#### 5. Toasts don't appear in production builds

**Symptom:** Works in `npm run dev` but not in the packaged Electron app.

**Root cause:** Vite tree-shaking or production build differences. Less likely with react-hot-toast but possible if imports are side-effect-only.

**How to diagnose:**
1. Run the packaged app with DevTools enabled (`--inspect` or `ELECTRON_ENABLE_LOGGING=1`).
2. Check if `[data-rht-toaster]` exists in the DOM.
3. Verify `react-hot-toast` is included in the production bundle (check the Vite build output).

**Fix:** Ensure `react-hot-toast` is listed in `dependencies` (not `devDependencies`) in `package.json`. Check that the import in `AppShell.tsx` is not conditional.

---

### Adding a New Overlay Layer

When introducing a new overlay (dropdown, popover, sidebar, etc.):

1. Choose a z-index **below 9990** (reserved for fullscreen log viewer) unless the overlay must appear above fullscreen content.
2. Never use `z-index: 9999` — this was react-hot-toast's old default and collides with the fullscreen log viewer.
3. Update the stacking table in this document.
4. Add the new layer to the stacking order assertion in `tests/unit/toast-zindex.test.ts`.
5. Run `npx vitest run tests/unit/toast-zindex.test.ts` to validate.

---

### Toast Service API Reference

All toast calls go through `src/renderer/services/toastService.ts`:

```ts
import { toastService } from "./services/toastService";

toastService.success("Plan created.");     // green border, 4s duration
toastService.error("IPC call failed.");    // red border, 6s duration
toastService.info("Run cancelled.");       // ℹ️ icon, 4s duration
toastService.warning("Clipboard unavailable."); // amber border, 5s duration
```

Each method returns a `string` toast ID that can be passed to `toast.dismiss(id)` if manual dismissal is needed.

**Active call sites** (as of this writing):
- `discoveryStore.ts` — discovery complete/continue success and error
- `runStore.ts` — task completed, task failed, run cancelled
- `planStore.ts` — plan created, deleted, archived, restored (+ error variants)
- `DiscoveryView.tsx` — clipboard copy success, warning, and error
- `ULogViewer.tsx` — log clipboard copy success
