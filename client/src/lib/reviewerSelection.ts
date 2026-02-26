type ClosestCapable = {
  closest?: (selector: string) => unknown;
};

/**
 * Row click should toggle reviewer only when the click did not originate
 * from the checkbox itself (or one of its descendants).
 */
export function shouldToggleReviewerFromRowClick(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") {
    return true;
  }

  const closest = (target as ClosestCapable).closest;
  if (typeof closest !== "function") {
    return true;
  }

  return closest("[role='checkbox']") == null;
}
