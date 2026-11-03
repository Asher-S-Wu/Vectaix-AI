export function playRequestedAudioOnce({
  requestId,
  pendingRequestIdRef,
  audioElement,
}) {
  if (
    !requestId
    || pendingRequestIdRef.current !== requestId
    || !audioElement
  ) {
    return false;
  }

  pendingRequestIdRef.current = "";
  const playPromise = audioElement.play();
  if (playPromise && typeof playPromise.catch === "function") {
    void playPromise.catch(() => undefined);
  }
  return true;
}
