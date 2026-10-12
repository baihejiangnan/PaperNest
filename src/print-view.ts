/** Print export HTML from a hidden frame that cannot run scripts.
 *
 * The frame is same-origin (so the app can fill it in and call print) but has
 * no `allow-scripts`: a document from anyone may be printed, and a same-origin
 * frame able to run script would reach the app's IPC. Math and code
 * highlighting, which the standalone HTML export does with its own scripts,
 * are therefore rendered into the frame from here. */
export async function printHtml(html: string): Promise<void> {
  const [{ default: katex }, { default: hljs }] = await Promise.all([
    import("katex"),
    import("highlight.js/lib/common"),
  ]);

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  const loaded = new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
  frame.srcdoc = html;
  document.body.appendChild(frame);
  await loaded;

  const doc = frame.contentDocument;
  const view = frame.contentWindow;
  if (!doc || !view) {
    frame.remove();
    return;
  }
  // comrak emits $...$ / $$...$$ as spans without the delimiters.
  for (const el of doc.querySelectorAll<HTMLElement>("[data-math-style]")) {
    el.innerHTML = katex.renderToString(el.textContent ?? "", {
      displayMode: el.dataset.mathStyle === "display",
      throwOnError: false,
    });
  }
  for (const el of doc.querySelectorAll<HTMLElement>("pre > code")) {
    // comrak puts the fence language on <pre lang>; without it hljs guesses.
    const lang = el.parentElement?.getAttribute("lang");
    if (lang && hljs.getLanguage(lang)) el.classList.add(`language-${lang}`);
    hljs.highlightElement(el);
  }

  // Give fonts and inlined images a moment to lay out before printing.
  window.setTimeout(() => {
    view.addEventListener("afterprint", () => frame.remove(), { once: true });
    view.focus();
    view.print();
  }, 350);
}
