// 首屏截图的渲染 / 源码切换，对应应用里的 Ctrl+/。没有脚本时只显示渲染视图。
const views = {
  render: document.getElementById("view-render"),
  source: document.getElementById("view-source"),
};
const group = document.querySelector(".view-toggle");

if (group && views.render && views.source) {
  group.hidden = false;
  const buttons = [...group.querySelectorAll("button")];
  for (const button of buttons) {
    button.addEventListener("click", () => {
      for (const [name, el] of Object.entries(views)) el.hidden = name !== button.dataset.view;
      for (const other of buttons) other.setAttribute("aria-pressed", String(other === button));
    });
  }
}
