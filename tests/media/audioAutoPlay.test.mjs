import assert from "node:assert/strict";
import test from "node:test";

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
