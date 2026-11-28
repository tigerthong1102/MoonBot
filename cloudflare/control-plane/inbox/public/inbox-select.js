import { selectMarkup } from "./inbox-select-template.js";

const template = document.createElement("template");
template.innerHTML = selectMarkup;

export function inboxSelect() {
  const wrapper = template.content.firstElementChild.cloneNode(true);
  wrapper.dataset.inboxSelect = "";
  return { wrapper, select: wrapper.querySelector("select") };
}

export function installInboxSelects(fields = document.querySelectorAll("inbox-select")) {
  for (const field of fields) {
    if (field.closest("[data-inbox-select]")) continue;
    const { wrapper, select } = inboxSelect();
    if (field.tagName === "SELECT") {
      field.classList.add(...select.classList);
      field.dataset.look = select.dataset.look;
      field.replaceWith(wrapper);
      select.replaceWith(field);
      continue;
    }
    for (const { name, value } of field.attributes) select.setAttribute(name, value);
    select.append(...field.childNodes);
    field.replaceWith(wrapper);
  }
}
