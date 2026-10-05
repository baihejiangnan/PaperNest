import { onLangChange, t, type I18nKey } from "./i18n";

const DURATION = 4000;
type Notice = {
  host: HTMLDivElement;
  pill: HTMLDivElement;
  message: HTMLSpanElement;
  close: HTMLButtonElement;
  key: I18nKey;
  returnFocus: HTMLElement | null;
  timer: ReturnType<typeof setTimeout> | undefined;
  frame: number;
};
let active: Notice | null = null;

/** Match only format failures from read_document, never filesystem errors. */
function unsupportedReason(path: string, error: unknown): I18nKey | null {
  const detail = String(error);
  if (detail === `Cannot open ${path}: the file appears to be binary.`) return "notice.unsupportedFormat";
  if (detail === `Cannot open ${path}: the file is not valid UTF-8 text.`) return "notice.unsupportedEncoding";
  return null;
}

function schedule(notice: Notice): void {
  clearTimeout(notice.timer);
  if (active !== notice) return;
  if (notice.pill.matches(":hover") || notice.pill.contains(document.activeElement)) return;
  notice.timer = setTimeout(() => { if (active === notice) dismissPreviewNotice(); }, DURATION);
}

/** No focus isolation or overlay: reading and file navigation stay available. */
export function showUnsupportedPreviewNotice(path: string, error: unknown): boolean {
  const key = unsupportedReason(path, error);
  if (!key) return false;
  if (!active) {
    const host = document.createElement("div");
    host.className = "preview-notice-host";
    const pill = document.createElement("div");
    pill.className = "preview-notice";
    const icon = document.createElement("span");
    icon.className = "preview-notice-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 10 17H2zM12 9v5M12 17v.1"/></svg>';
    const message = document.createElement("span");
    message.className = "preview-notice-message";
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    message.setAttribute("aria-atomic", "true");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "preview-notice-close";
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m7 7 10 10M17 7 7 17"/></svg>';
    close.querySelector("svg")!.setAttribute("aria-hidden", "true");
    pill.append(icon, message, close);
    host.appendChild(pill);
    document.body.appendChild(host);
    const notice: Notice = { host, pill, message, close, key, returnFocus: null, timer: undefined, frame: 0 };
    active = notice;
    close.addEventListener("click", () => dismissPreviewNotice());
    pill.addEventListener("mouseenter", () => clearTimeout(notice.timer));
    pill.addEventListener("mouseleave", () => schedule(notice));
    pill.addEventListener("focusin", event => {
      clearTimeout(notice.timer);
      if (event.relatedTarget instanceof HTMLElement && !pill.contains(event.relatedTarget)) {
        notice.returnFocus = event.relatedTarget;
      }
    });
    pill.addEventListener("focusout", () => {
      // activeElement has not moved yet during focusout.
      queueMicrotask(() => { if (active === notice) schedule(notice); });
    });
  }
  const notice = active;
  notice.key = key;
  const filename = path.split(/[\\/]/).pop() ?? path;
  notice.pill.title = filename;
  notice.close.setAttribute("aria-label", t("notice.close"));
  if (!notice.pill.contains(document.activeElement)) {
    notice.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  clearTimeout(notice.timer);
  cancelAnimationFrame(notice.frame);
  // Empty first so the live region can announce repeated identical failures.
  notice.message.textContent = "";
  notice.frame = requestAnimationFrame(() => {
    if (active !== notice) return;
    notice.message.textContent = t(key);
    notice.pill.classList.add("is-visible");
    schedule(notice);
  });
  return true;
}

export function dismissPreviewNotice(): boolean {
  const notice = active;
  if (!notice) return false;
  active = null;
  clearTimeout(notice.timer);
  cancelAnimationFrame(notice.frame);
  const restoreFocus = notice.pill.contains(document.activeElement);
  notice.host.remove();
  if (restoreFocus && notice.returnFocus?.isConnected && !notice.returnFocus.closest("[inert]")) {
    notice.returnFocus.focus({ preventScroll: true });
  }
  return true;
}

onLangChange(() => {
  if (!active) return;
  active.message.textContent = t(active.key);
  active.close.setAttribute("aria-label", t("notice.close"));
});
