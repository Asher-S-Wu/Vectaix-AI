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
  void audioElement.play().catch(() => undefined);
  return true;
}
