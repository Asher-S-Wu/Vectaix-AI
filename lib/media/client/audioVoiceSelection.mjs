const AUDIO_VOICE_STORAGE_KEYS = Object.freeze({
  qwen: "vectaix_ui_qwenAudioVoice_v1",
  minimax: "vectaix_ui_minimaxAudioVoice_v1",
  doubao: "vectaix_ui_doubaoAudioVoice_v1",
});

export function resolveAudioVoiceId({
  storedVoiceId,
  availableVoiceIds,
  defaultVoiceId,
}) {
  return storedVoiceId && availableVoiceIds.includes(storedVoiceId)
    ? storedVoiceId
    : defaultVoiceId;
}

export function canApplyAudioVoiceResponse({
  requestId,
  latestRequestId,
  stateVersionAtStart,
  currentStateVersion,
}) {
  return requestId === latestRequestId && stateVersionAtStart === currentStateVersion;
}

export function resolveAudioVoiceIdAfterDelete({
  currentVoiceId,
  deletedVoiceId,
  defaultVoiceId,
}) {
  return currentVoiceId === deletedVoiceId ? defaultVoiceId : currentVoiceId;
}

export function createAudioVoiceSelectionController({
  storageKey,
  readSetting,
  writeSetting,
  initialVoiceId = "",
}) {
  let currentVoiceId = initialVoiceId;
  let selectionTouched = false;
  let stateVersion = 0;
  let latestRequestId = 0;
  let loadingRequestId = 0;

  const canApplyLoad = (load) => canApplyAudioVoiceResponse({
    requestId: load.requestId,
    latestRequestId,
    stateVersionAtStart: load.stateVersionAtStart,
    currentStateVersion: stateVersion,
  });

  const select = (nextVoiceId) => {
    currentVoiceId = nextVoiceId;
    selectionTouched = true;
    writeSetting(storageKey, nextVoiceId || null);
    return currentVoiceId;
  };

  return {
    beginLoad() {
      latestRequestId += 1;
      loadingRequestId = latestRequestId;
      return {
        requestId: latestRequestId,
        stateVersionAtStart: stateVersion,
      };
    },
    canApplyLoad,
    resolveLoadedVoice(load, { availableVoiceIds, defaultVoiceId }) {
      if (!canApplyLoad(load)) {
        return { applied: false, voiceId: currentVoiceId };
      }
      currentVoiceId = resolveAudioVoiceId({
        storedVoiceId: selectionTouched ? currentVoiceId : readSetting(storageKey),
        availableVoiceIds,
        defaultVoiceId,
      });
      stateVersion += 1;
      return { applied: true, voiceId: currentVoiceId };
    },
    finishLoad(load) {
      if (load.requestId !== latestRequestId) return false;
      loadingRequestId = 0;
      return true;
    },
    isLoading() {
      return loadingRequestId !== 0;
    },
    markMutation() {
      stateVersion += 1;
    },
    captureStateVersion() {
      return stateVersion;
    },
    isStateVersionCurrent(version) {
      return version === stateVersion;
    },
    reportErrorIfCurrent(version, reportError) {
      if (version !== stateVersion) return false;
      reportError();
      return true;
    },
    select,
    resolveAfterDelete({ deletedVoiceId, defaultVoiceId }) {
      const nextVoiceId = resolveAudioVoiceIdAfterDelete({
        currentVoiceId,
        deletedVoiceId,
        defaultVoiceId,
      });
      return nextVoiceId === currentVoiceId ? currentVoiceId : select(nextVoiceId);
    },
    getVoiceId() {
      return currentVoiceId;
    },
  };
}

function createAudioVoicePageAdapter(provider, {
  readSetting,
  writeSetting,
  initialVoiceId = "",
}) {
  return createAudioVoiceSelectionController({
    storageKey: AUDIO_VOICE_STORAGE_KEYS[provider],
    readSetting,
    writeSetting,
    initialVoiceId,
  });
}

export function createQwenAudioVoicePageAdapter(options) {
  return createAudioVoicePageAdapter("qwen", options);
}

export function createMinimaxAudioVoicePageAdapter(options) {
  return createAudioVoicePageAdapter("minimax", options);
}

export function createDoubaoAudioVoicePageAdapter(options) {
  return createAudioVoicePageAdapter("doubao", options);
}
