// 界面示意中的渲染 / 源码切换，对应应用里的 Ctrl+/。
const render = document.querySelector(".doc-render");
const source = document.querySelector(".doc-source");
const segments = [...document.querySelectorAll(".mock-mode .seg")];

for (const segment of segments) {
  segment.addEventListener("click", () => {
    const showSource = segment.dataset.mode === "source";
    render.hidden = showSource;
    source.hidden = !showSource;
    for (const other of segments) {
      const on = other === segment;
      other.classList.toggle("is-on", on);
      other.setAttribute("aria-pressed", String(on));
    }
  });
}
