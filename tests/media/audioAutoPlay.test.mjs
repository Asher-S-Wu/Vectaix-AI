import assert from "node:assert/strict";
import test from "node:test";

function createMemorySettings() {
  const values = new Map();
  return {
    readSetting(key) {
      return values.get(key) || null;
    },
    writeSetting(key, value) {
      if (value == null) values.delete(key);
      else values.set(key, String(value));
    },
  };
}

test("重新进入音频页时恢复上次选中的可用音色", async () => {
  const voiceSelectionModule = await import("../../lib/media/client/audioVoiceSelection.mjs");

  assert.equal(voiceSelectionModule.resolveAudioVoiceId({
    storedVoiceId: "custom-voice-2",
    availableVoiceIds: ["default-voice", "custom-voice-2"],
    defaultVoiceId: "default-voice",
  }), "custom-voice-2");
});

test("旧音色列表响应不能覆盖请求期间新建的音色", async () => {
  const voiceSelectionModule = await import("../../lib/media/client/audioVoiceSelection.mjs");

  assert.equal(voiceSelectionModule.canApplyAudioVoiceResponse({
    requestId: 2,
    latestRequestId: 2,
    stateVersionAtStart: 4,
    currentStateVersion: 5,
  }), false);
  assert.equal(voiceSelectionModule.canApplyAudioVoiceResponse({
    requestId: 2,
    latestRequestId: 2,
    stateVersionAtStart: 5,
    currentStateVersion: 5,
  }), true);
});

test("删除旧音色完成时不覆盖之后选择的新音色", async () => {
  const voiceSelectionModule = await import("../../lib/media/client/audioVoiceSelection.mjs");

  assert.equal(voiceSelectionModule.resolveAudioVoiceIdAfterDelete({
    currentVoiceId: "new-voice",
    deletedVoiceId: "old-voice",
    defaultVoiceId: "default-voice",
  }), "new-voice");
  assert.equal(voiceSelectionModule.resolveAudioVoiceIdAfterDelete({
    currentVoiceId: "old-voice",
    deletedVoiceId: "old-voice",
    defaultVoiceId: "default-voice",
  }), "default-voice");
});

test("音色控制器保存选择并在重新进入后恢复", async () => {
  const voiceSelectionModule = await import("../../lib/media/client/audioVoiceSelection.mjs");

  const settings = createMemorySettings();
  const storageKey = "audio-voice:qwen";
  const firstVisit = voiceSelectionModule.createAudioVoiceSelectionController({
    storageKey,
    ...settings,
  });
  firstVisit.select("custom-voice-2");

  const nextVisit = voiceSelectionModule.createAudioVoiceSelectionController({
    storageKey,
    ...settings,
  });
  const load = nextVisit.beginLoad();
  assert.deepEqual(nextVisit.resolveLoadedVoice(load, {
    availableVoiceIds: ["default-voice", "custom-voice-2"],
    defaultVoiceId: "default-voice",
  }), {
    applied: true,
    voiceId: "custom-voice-2",
  });
});

test("音色数据变化使旧响应失效但不会卡住加载状态", async () => {
  const voiceSelectionModule = await import("../../lib/media/client/audioVoiceSelection.mjs");

  const controller = voiceSelectionModule.createAudioVoiceSelectionController({
    storageKey: "audio-voice:minimax",
    ...createMemorySettings(),
  });
  const load = controller.beginLoad();
  assert.equal(controller.isLoading(), true);
  const stateVersion = controller.captureStateVersion();

  controller.markMutation();
  assert.equal(controller.isStateVersionCurrent(stateVersion), false);
  let staleErrorReported = false;
  assert.equal(controller.reportErrorIfCurrent(stateVersion, () => {
    staleErrorReported = true;
  }), false);
  assert.equal(staleErrorReported, false);
  assert.deepEqual(controller.resolveLoadedVoice(load, {
    availableVoiceIds: ["old-voice"],
    defaultVoiceId: "old-voice",
  }), {
    applied: false,
    voiceId: "",
  });
  assert.equal(controller.finishLoad(load), true);
  assert.equal(controller.isLoading(), false);
});

test("新音色列表生效后更早的后台同步响应随即失效", async () => {
  const voiceSelectionModule = await import("../../lib/media/client/audioVoiceSelection.mjs");
  const controller = voiceSelectionModule.createAudioVoiceSelectionController({
    storageKey: "audio-voice:qwen",
    ...createMemorySettings(),
  });
  const stateVersion = controller.captureStateVersion();
  const load = controller.beginLoad();

  assert.deepEqual(controller.resolveLoadedVoice(load, {
    availableVoiceIds: ["new-voice"],
    defaultVoiceId: "new-voice",
  }), {
    applied: true,
    voiceId: "new-voice",
  });
  assert.equal(controller.isStateVersionCurrent(stateVersion), false);
});

test("三个音频服务使用彼此独立的音色记忆空间", async () => {
  const voiceSelectionModule = await import("../../lib/media/client/audioVoiceSelection.mjs");
  const settings = createMemorySettings();
  const qwen = voiceSelectionModule.createQwenAudioVoicePageAdapter(settings);
  const minimax = voiceSelectionModule.createMinimaxAudioVoicePageAdapter(settings);
  const doubao = voiceSelectionModule.createDoubaoAudioVoicePageAdapter(settings);
  qwen.select("qwen-voice");
  minimax.select("minimax-voice");
  doubao.select("doubao-voice");

  const restoredIds = [
    [voiceSelectionModule.createQwenAudioVoicePageAdapter(settings), "qwen-voice"],
    [voiceSelectionModule.createMinimaxAudioVoicePageAdapter(settings), "minimax-voice"],
    [voiceSelectionModule.createDoubaoAudioVoicePageAdapter(settings), "doubao-voice"],
  ].map(([adapter, expectedVoiceId]) => {
    const load = adapter.beginLoad();
    const result = adapter.resolveLoadedVoice(load, {
      availableVoiceIds: ["qwen-voice", "minimax-voice", "doubao-voice"],
      defaultVoiceId: "default-voice",
    });
    assert.equal(result.voiceId, expectedVoiceId);
    return result.voiceId;
  });
  assert.deepEqual(restoredIds, ["qwen-voice", "minimax-voice", "doubao-voice"]);
});

test("页面适配器在删除当前音色后同步更新记忆", async () => {
  const voiceSelectionModule = await import("../../lib/media/client/audioVoiceSelection.mjs");
  const settings = createMemorySettings();
  const adapter = voiceSelectionModule.createDoubaoAudioVoicePageAdapter(settings);
  adapter.select("deleted-voice");
  assert.equal(adapter.resolveAfterDelete({
    deletedVoiceId: "deleted-voice",
    defaultVoiceId: "fallback-voice",
  }), "fallback-voice");

  const nextVisit = voiceSelectionModule.createDoubaoAudioVoicePageAdapter(settings);
  const load = nextVisit.beginLoad();
  assert.equal(nextVisit.resolveLoadedVoice(load, {
    availableVoiceIds: ["deleted-voice", "fallback-voice"],
    defaultVoiceId: "deleted-voice",
  }).voiceId, "fallback-voice");
});

test("同一条新生成的语音只自动播放一次", async () => {
  const autoPlayModule = await import("../../lib/media/client/audioAutoPlay.mjs");

  assert.equal(typeof autoPlayModule.playNewGenerationOnce, "function");

  const pendingGenerationIdRef = { current: "generation-1" };
  let playCount = 0;
  const audioElement = {
    play() {
      playCount += 1;
      return Promise.resolve();
    },
  };

  assert.equal(autoPlayModule.playNewGenerationOnce({
    generationId: "generation-1",
    pendingGenerationIdRef,
    audioElement,
  }), true);
  assert.equal(autoPlayModule.playNewGenerationOnce({
    generationId: "generation-1",
    pendingGenerationIdRef,
    audioElement,
  }), false);
  assert.equal(playCount, 1);
});

test("新语音的播放器稍后挂载时仍只自动播放一次", async () => {
  const autoPlayModule = await import("../../lib/media/client/audioAutoPlay.mjs");
  const pendingGenerationIdRef = { current: "generation-2" };
  let playCount = 0;

  assert.equal(autoPlayModule.playNewGenerationOnce({
    generationId: "generation-2",
    pendingGenerationIdRef,
    audioElement: null,
  }), false);
  assert.equal(pendingGenerationIdRef.current, "generation-2");

  const audioElement = {
    play() {
      playCount += 1;
      return Promise.resolve();
    },
  };
  assert.equal(autoPlayModule.playNewGenerationOnce({
    generationId: "generation-2",
    pendingGenerationIdRef,
    audioElement,
  }), true);
  assert.equal(autoPlayModule.playNewGenerationOnce({
    generationId: "generation-2",
    pendingGenerationIdRef,
    audioElement,
  }), false);
  assert.equal(playCount, 1);
});
