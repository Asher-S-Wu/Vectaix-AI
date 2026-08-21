export function playNewGenerationOnce({
  generationId,
  pendingGenerationIdRef,
  audioElement,
}) {
  if (
    !generationId
    || pendingGenerationIdRef.current !== generationId
    || !audioElement
  ) {
    return false;
  }

  pendingGenerationIdRef.current = "";
  const playPromise = audioElement.play();
  if (playPromise && typeof playPromise.catch === "function") {
    void playPromise.catch(() => undefined);
  }
  return true;
}
