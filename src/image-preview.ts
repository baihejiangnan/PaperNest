import { t } from "./i18n";

export const IMAGE_PREVIEW_EVENT = "mdmeow:image-preview";
export const IMAGE_SOURCE_EVENT = "mdmeow:image-source";

export interface ImagePreviewRequest {
  src: string;
  alt: string;
}

/** A read-only lightbox. Viewing an image never changes the Markdown document. */
export class ImagePreview {
  private readonly root: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly image: HTMLImageElement;
  private readonly caption: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly closeButton: HTMLButtonElement;
  private previousFocus: HTMLElement | null = null;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private dragPointer: number | null = null;
  private lastX = 0;
  private lastY = 0;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "mdmeow-image-preview";
    this.root.hidden = true;
    this.root.tabIndex = -1;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");

    const header = document.createElement("div");
    header.className = "mdmeow-image-preview-header";
    this.caption = document.createElement("div");
    this.caption.className = "mdmeow-image-preview-caption";
    this.closeButton = document.createElement("button");
    this.closeButton.type = "button";
    this.closeButton.className = "mdmeow-image-preview-close";
    this.closeButton.textContent = "×";
    this.closeButton.addEventListener("click", () => this.close());
    header.append(this.caption, this.closeButton);

    this.stage = document.createElement("div");
    this.stage.className = "mdmeow-image-preview-stage";
    this.image = document.createElement("img");
    this.image.draggable = false;
    this.stage.appendChild(this.image);
    this.stage.addEventListener("click", (event) => {
      if (event.target === this.stage) this.close();
    });
    this.stage.addEventListener("wheel", this.onWheel, { passive: false });
    this.stage.addEventListener("pointerdown", this.onPointerDown);
    this.stage.addEventListener("pointermove", this.onPointerMove);
    this.stage.addEventListener("pointerup", this.onPointerUp);
    this.stage.addEventListener("pointercancel", this.onPointerUp);

    this.hint = document.createElement("div");
    this.hint.className = "mdmeow-image-preview-hint";
    this.root.append(header, this.stage, this.hint);
    this.root.addEventListener("contextmenu", (event) => event.preventDefault());
    document.body.appendChild(this.root);
  }

  open(src: string, alt: string): void {
    if (!src) return;
    this.previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    this.root.setAttribute("aria-label", t("image.preview"));
    this.closeButton.title = t("image.previewClose");
    this.closeButton.setAttribute("aria-label", t("image.previewClose"));
    this.caption.textContent = alt;
    this.hint.textContent = t("image.previewHint");
    this.image.alt = alt;
    this.image.src = src;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.renderTransform();
    this.root.hidden = false;
    this.root.focus();
    document.addEventListener("keydown", this.onKeyDown, true);
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.image.removeAttribute("src");
    if (this.dragPointer !== null && this.stage.hasPointerCapture(this.dragPointer)) {
      this.stage.releasePointerCapture(this.dragPointer);
    }
    this.dragPointer = null;
    this.stage.classList.remove("dragging");
    document.removeEventListener("keydown", this.onKeyDown, true);
    this.previousFocus?.focus();
    this.previousFocus = null;
  }

  private renderTransform(): void {
    this.image.style.transform =
      `translate(${this.offsetX}px, ${this.offsetY}px) scale(${this.scale})`;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Tab") {
      event.preventDefault();
      this.closeButton.focus();
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.close();
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (!event.ctrlKey) return;
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.scale = Math.max(0.25, Math.min(8, this.scale * factor));
    this.renderTransform();
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 2 || event.target !== this.image) return;
    event.preventDefault();
    this.dragPointer = event.pointerId;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.stage.setPointerCapture(event.pointerId);
    this.stage.classList.add("dragging");
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.dragPointer) return;
    this.offsetX += event.clientX - this.lastX;
    this.offsetY += event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.renderTransform();
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.dragPointer) return;
    this.dragPointer = null;
    this.stage.classList.remove("dragging");
    if (this.stage.hasPointerCapture(event.pointerId)) {
      this.stage.releasePointerCapture(event.pointerId);
    }
  };
}
