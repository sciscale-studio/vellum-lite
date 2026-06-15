interface AnchorRect {
  left: number;
  top: number;
  bottom: number;
}

interface PopoverPositionOptions {
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  gap?: number;
  margin?: number;
}

export function getClampedPopoverPosition(
  anchor: AnchorRect,
  {
    width,
    height,
    viewportWidth,
    viewportHeight,
    gap = 8,
    margin = 8,
  }: PopoverPositionOptions,
) {
  const maxLeft = Math.max(margin, viewportWidth - width - margin);
  const left = Math.min(Math.max(anchor.left, margin), maxLeft);

  const below = anchor.bottom + gap;
  const above = anchor.top - height - gap;
  const hasRoomBelow = below + height <= viewportHeight - margin;
  const hasRoomAbove = above >= margin;
  const preferredTop = hasRoomBelow || !hasRoomAbove ? below : above;
  const maxTop = Math.max(margin, viewportHeight - height - margin);
  const top = Math.min(Math.max(preferredTop, margin), maxTop);

  return { left, top };
}
