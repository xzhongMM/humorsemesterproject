export const STUDY_CAPTION_BATCH_SIZE = 200;

export function shuffleStudyCaptionIds(captionIds: readonly string[]) {
  const shuffled = [...captionIds];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

export function restoreStudyCaptionOrder(
  availableCaptionIds: readonly string[],
  savedCaptionOrder: readonly string[] | null | undefined
) {
  if (!savedCaptionOrder?.length) {
    return shuffleStudyCaptionIds(availableCaptionIds);
  }

  const availableIds = new Set(availableCaptionIds);
  const restoredOrder = savedCaptionOrder.filter((id) => availableIds.has(id));
  const restoredIds = new Set(restoredOrder);

  return [
    ...restoredOrder,
    ...availableCaptionIds.filter((id) => !restoredIds.has(id)),
  ];
}

export function resolveStudyCaptionIndex(
  captionOrder: readonly string[],
  currentCaptionId: string | null | undefined,
  savedCaptionIndex: number | null | undefined
) {
  if (!captionOrder.length) {
    return 0;
  }

  if (currentCaptionId) {
    const currentCaptionIndex = captionOrder.indexOf(currentCaptionId);
    if (currentCaptionIndex >= 0) {
      return currentCaptionIndex;
    }
  }

  const normalizedIndex =
    typeof savedCaptionIndex === "number" &&
    Number.isSafeInteger(savedCaptionIndex)
      ? savedCaptionIndex
      : 0;

  return Math.min(captionOrder.length - 1, Math.max(0, normalizedIndex));
}
