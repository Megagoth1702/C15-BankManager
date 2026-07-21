/** Move an element to `document.body` so `position: fixed` uses the viewport. */
export function portalBody(node: HTMLElement): { destroy: () => void } {
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    },
  };
}