/**
 * Shared DOM interaction helpers.
 *
 * Centralizes querySelector-based focus helpers so keyboard shortcuts
 * and command palette actions share the same logic without duplication.
 */

/**
 * Focus and select the plan search input on the PlanListView.
 *
 * Uses the `aria-label` attribute for discovery since CSS module class
 * names are hashed and unreliable as selectors.
 *
 * No-op when the search input is not in the DOM (e.g. on a different view).
 */
export function focusPlanSearchInput(): void {
  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search plans"]'
  );
  if (input) {
    input.focus();
    input.select();
  }
}
