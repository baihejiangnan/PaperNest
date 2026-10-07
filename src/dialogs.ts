import { t } from "./i18n";
import { activateModal, deactivateModal } from "./modal";

export interface DialogOptions {
  title?: string;
  kind?: "info" | "warning" | "error";
  confirmLabel?: string;
  danger?: boolean;
  details?: HTMLElement;
  rememberLabel?: string;
  ready?: Promise<void>;
  initialFocus?: HTMLElement;
  canConfirm?: () => boolean;
}
export interface DialogResult { confirmed: boolean; remember: boolean }
let queue: Promise<unknown> = Promise.resolve();

/** Serialise app dialogs so concurrent errors cannot cover a pending question. */
export function confirmDialog(body: string, options: DialogOptions = {}, confirmation = true): Promise<DialogResult> {
  if (options.ready) void options.ready.catch(() => {});
  const pending = queue.then(() => renderDialog(body, options, confirmation));
  queue = pending.catch(() => {});
  return pending;
}

function renderDialog(body: string, options: DialogOptions, confirmation: boolean): Promise<DialogResult> {
  return new Promise(resolve => {
    const root = document.createElement("div");
    root.className = "app-dialog-overlay";
    const card = document.createElement("section");
    card.className = "app-dialog-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "app-dialog-title");
    card.setAttribute("aria-describedby", "app-dialog-description");
    const title = document.createElement("h2");
    title.id = "app-dialog-title";
    title.textContent = options.title && options.title !== "PaperNest" ? options.title
      : t(options.kind === "error" ? "dialog.errorTitle" : confirmation ? "dialog.confirmTitle" : "dialog.infoTitle");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "app-dialog-close";
    close.textContent = "×";
    close.setAttribute("aria-label", t("about.close"));
    const description = document.createElement("p");
    description.id = "app-dialog-description";
    description.className = "app-dialog-description";
    description.textContent = body;
    const footer = document.createElement("footer");
    footer.className = "app-dialog-footer";
    const remember = document.createElement("input");
    remember.type = "checkbox";
    if (options.rememberLabel) {
      const label = document.createElement("label");
      label.className = "app-dialog-remember";
      label.append(remember, document.createTextNode(options.rememberLabel));
      footer.appendChild(label);
    }
    const actions = document.createElement("div");
    actions.className = "app-dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "app-dialog-button";
    cancel.textContent = t("dialog.cancel");
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = `app-dialog-button ${options.danger ? "is-danger" : "is-primary"}`;
    confirm.textContent = options.confirmLabel ?? t(confirmation ? "dialog.confirm" : "dialog.ok");
    const validate = () => { confirm.disabled = options.canConfirm ? !options.canConfirm() : false; };
    if (options.canConfirm) {
      validate();
      options.details?.addEventListener("input", validate);
    }
    if (options.ready) {
      confirm.disabled = true;
      card.setAttribute("aria-busy", "true");
      void options.ready.then(() => { confirm.disabled = false; card.removeAttribute("aria-busy"); })
        .catch(() => { card.removeAttribute("aria-busy"); });
    }
    let finished = false;
    const finish = (confirmed: boolean) => {
      if (finished) return;
      finished = true;
      root.hidden = true;
      deactivateModal(root);
      root.remove();
      resolve({ confirmed, remember: confirmed && remember.checked });
    };
    cancel.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(true));
    close.addEventListener("click", () => finish(false));
    root.addEventListener("click", event => { if (event.target === root) finish(false); });
    root.addEventListener("dialog-dismiss", () => finish(false));
    if (confirmation) actions.appendChild(cancel);
    actions.appendChild(confirm);
    footer.appendChild(actions);
    card.append(title, close, description);
    if (options.details) card.appendChild(options.details);
    card.appendChild(footer);
    root.appendChild(card);
    document.body.appendChild(root);
    // Opening or pressing Enter must not accidentally approve a destructive action.
    activateModal(root, () => finish(false), options.initialFocus ?? (confirmation ? cancel : confirm));
  });
}

export async function ask(body: string, options: DialogOptions = {}): Promise<boolean> {
  return (await confirmDialog(body, options)).confirmed;
}

export async function message(body: string, options: DialogOptions = {}): Promise<void> {
  await confirmDialog(body, options, false);
}

/** A small application input dialog, using the same queue and focus lifecycle. */
export async function promptText(label: string, options: {
  title: string;
  value?: string;
  placeholder?: string;
  validate?: (value: string) => boolean;
}): Promise<string | null> {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "app-dialog-input";
  input.value = options.value ?? "";
  input.placeholder = options.placeholder ?? "";
  input.setAttribute("aria-label", label);
  const canConfirm = () => Boolean(input.value.trim()) && (options.validate?.(input.value.trim()) ?? true);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      if (canConfirm()) input.closest(".app-dialog-card")?.querySelector<HTMLButtonElement>(".is-primary")?.click();
    }
  });
  const result = await confirmDialog(label, {
    title: options.title, details: input, initialFocus: input, canConfirm,
  });
  return result.confirmed ? input.value.trim() : null;
}
