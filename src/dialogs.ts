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
  /** Optional middle action between Cancel and the confirm button. */
  alternateLabel?: string;
  alternateDanger?: boolean;
  /** Initially focus the confirm button instead of Cancel (non-destructive confirms only). */
  focusConfirm?: boolean;
}
export interface DialogResult { confirmed: boolean; remember: boolean; choice: "confirm" | "alternate" | "cancel" }
export type SaveChangesChoice = "save" | "discard" | "cancel";
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
    let alternate: HTMLButtonElement | null = null;
    if (options.alternateLabel) {
      alternate = document.createElement("button");
      alternate.type = "button";
      alternate.className = `app-dialog-button${options.alternateDanger ? " is-danger" : ""}`;
      alternate.textContent = options.alternateLabel;
    }
    let finished = false;
    const finish = (choice: DialogResult["choice"]) => {
      if (finished) return;
      finished = true;
      root.hidden = true;
      deactivateModal(root);
      root.remove();
      const confirmed = choice === "confirm";
      resolve({ confirmed, remember: confirmed && remember.checked, choice });
    };
    cancel.addEventListener("click", () => finish("cancel"));
    confirm.addEventListener("click", () => finish("confirm"));
    alternate?.addEventListener("click", () => finish("alternate"));
    close.addEventListener("click", () => finish("cancel"));
    root.addEventListener("click", event => { if (event.target === root) finish("cancel"); });
    root.addEventListener("dialog-dismiss", () => finish("cancel"));
    if (confirmation) actions.appendChild(cancel);
    if (alternate) actions.appendChild(alternate);
    actions.appendChild(confirm);
    footer.appendChild(actions);
    card.append(title, close, description);
    if (options.details) card.appendChild(options.details);
    card.appendChild(footer);
    root.appendChild(card);
    document.body.appendChild(root);
    // Opening or pressing Enter must not accidentally approve a destructive action.
    // A non-destructive confirm (Save) may take initial focus; a destructive
    // alternate button never does.
    const initial = options.initialFocus
      ?? (!confirmation || (options.focusConfirm && !options.danger) ? confirm : cancel);
    activateModal(root, () => finish("cancel"), initial);
  });
}

export async function ask(body: string, options: DialogOptions = {}): Promise<boolean> {
  return (await confirmDialog(body, options)).confirmed;
}

/**
 * Unsaved-changes question with three real outcomes: Save (primary, initially
 * focused), Don't save (destructive) and Cancel. Esc, × and the overlay cancel.
 */
export async function askSaveChanges(body: string, options: { title?: string; saveLabel?: string; discardLabel?: string } = {}): Promise<SaveChangesChoice> {
  const result = await confirmDialog(body, {
    title: options.title ?? t("dialog.saveChangesTitle"),
    kind: "warning",
    confirmLabel: options.saveLabel ?? t("dialog.save"),
    alternateLabel: options.discardLabel ?? t("dialog.dontSave"),
    alternateDanger: true,
    focusConfirm: true,
  });
  return result.choice === "confirm" ? "save" : result.choice === "alternate" ? "discard" : "cancel";
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
