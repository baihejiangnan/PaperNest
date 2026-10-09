/** Shared focus lifecycle for application dialogs, including nested overlays. */
type Modal = { root: HTMLElement; close: () => void; returnFocus: HTMLElement | null };
const stack: Modal[] = [];
const background = new Map<HTMLElement, boolean>();
const selector = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(selector)].filter(
    el => !el.matches(":disabled") && !el.closest("[inert]") && el.getClientRects().length > 0,
  );
}

function isolate(): void {
  for (const [el, wasInert] of background) el.inert = wasInert;
  background.clear();
  let current: HTMLElement | undefined = stack[stack.length - 1]?.root;
  while (current && current !== document.body) {
    for (const sibling of current.parentElement?.children ?? []) {
      if (sibling instanceof HTMLElement && sibling !== current) {
        background.set(sibling, sibling.inert);
        sibling.inert = true;
      }
    }
    current = current.parentElement ?? undefined;
  }
}

export function hasActiveModal(): boolean { return stack.length > 0; }

export function activateModal(root: HTMLElement, close: () => void, initial?: HTMLElement): void {
  if (stack.some(modal => modal.root === root)) return;
  stack.push({ root, close, returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null });
  isolate();
  root.tabIndex = -1;
  (initial ?? focusable(root)[0] ?? root).focus();
}

export function deactivateModal(root: HTMLElement): void {
  const index = stack.findIndex(modal => modal.root === root);
  if (index < 0) return;
  const wasTop = index === stack.length - 1;
  const [modal] = stack.splice(index, 1);
  isolate();
  if (!wasTop) return;
  const top = stack[stack.length - 1];
  if (modal.returnFocus?.isConnected && !modal.returnFocus.closest("[inert]") && modal.returnFocus.getClientRects().length) {
    // Returning to the document must not scroll its caret into view and lose
    // the reading position restored after an update (or any modal).
    modal.returnFocus.focus({ preventScroll: true });
  } else if (top) {
    (focusable(top.root)[0] ?? top.root).focus();
  }
}

document.addEventListener("keydown", event => {
  const modal = stack[stack.length - 1];
  if (!modal) return;
  if (event.key === "Escape" && !event.isComposing) {
    // Shortcut capture gets its first Escape; the next Escape closes settings.
    if ((event.target as HTMLElement)?.matches(".settings-shortcut.listening")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    modal.close();
  } else if (event.key === "Tab") {
    const items = focusable(modal.root);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (!items.length || index < 0 || (event.shiftKey ? index === 0 : index === items.length - 1)) {
      event.preventDefault();
      (items.length ? items[event.shiftKey ? items.length - 1 : 0] : modal.root).focus();
    }
  }
}, true);

document.addEventListener("focusin", event => {
  const top = stack[stack.length - 1];
  if (top && !top.root.contains(event.target as Node)) (focusable(top.root)[0] ?? top.root).focus();
});
