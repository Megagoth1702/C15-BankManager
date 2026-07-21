/** Focus and select rename input when it mounts (F2 / double-click). */
export function focusRenameInput(node: HTMLInputElement): { destroy?: () => void } {
  requestAnimationFrame(() => {
    node.focus({ preventScroll: true });
    node.select();
  });
  return {};
}