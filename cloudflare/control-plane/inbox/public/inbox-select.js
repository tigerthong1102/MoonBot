import { selectMarkup } from "./inbox-messages.js";

const template = document.createElement("template");
template.innerHTML = selectMarkup;

export function inboxSelect() {
  const wrapper = template.content.firstElementChild.cloneNode(true);
  wrapper.dataset.inboxSelect = "";
  return { wrapper, select: wrapper.querySelector("select") };
}

export function installInboxSelects() {
  for (const field of document.querySelectorAll("inbox-select")) {
    const { wrapper, select } = inboxSelect();
    for (const { name, value } of field.attributes) select.setAttribute(name, value);
    select.append(...field.childNodes);
    field.replaceWith(wrapper);
  }
}
