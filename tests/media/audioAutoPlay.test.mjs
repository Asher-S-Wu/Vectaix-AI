import assert from "node:assert/strict";
import test from "node:test";

test("试听结果只播放一次，切换标签或搜索后重建播放器保持暂停，再次点击试听才播放", async () => {
  const { playRequestedAudioOnce } = await import("../../lib/media/client/audioAutoPlay.mjs");
  const pendingRequestIdRef = { current: "blob:preview-1" };
  let plays = 0;
  const mount = requestId => playRequestedAudioOnce({
    requestId,
    pendingRequestIdRef,
    audioElement: { play() { plays += 1; return Promise.resolve(); } },
  });

  assert.equal(mount("blob:preview-1"), true);
  assert.equal(mount("blob:preview-1"), false);
  assert.equal(mount("blob:preview-1"), false);
  assert.equal(plays, 1);

  pendingRequestIdRef.current = "blob:preview-2";
  assert.equal(mount("blob:preview-1"), false);
  assert.equal(pendingRequestIdRef.current, "blob:preview-2");
  assert.equal(mount("blob:preview-2"), true);
  assert.equal(mount("blob:preview-2"), false);
  assert.equal(plays, 2);
});

test("同一条新生成的语音只自动播放一次", async () => {
  const autoPlayModule = await import("../../lib/media/client/audioAutoPlay.mjs");

  assert.equal(typeof autoPlayModule.playRequestedAudioOnce, "function");

  const pendingRequestIdRef = { current: "generation-1" };
  let playCount = 0;
  const audioElement = {
    play() {
      playCount += 1;
      return Promise.resolve();
    },
  };

  assert.equal(autoPlayModule.playRequestedAudioOnce({
    requestId: "generation-1",
    pendingRequestIdRef,
    audioElement,
  }), true);
  assert.equal(autoPlayModule.playRequestedAudioOnce({
    requestId: "generation-1",
    pendingRequestIdRef,
    audioElement,
  }), false);
  assert.equal(playCount, 1);
});

test("新语音的播放器稍后挂载时仍只自动播放一次", async () => {
  const autoPlayModule = await import("../../lib/media/client/audioAutoPlay.mjs");
  const pendingRequestIdRef = { current: "generation-2" };
  let playCount = 0;

  assert.equal(autoPlayModule.playRequestedAudioOnce({
    requestId: "generation-2",
    pendingRequestIdRef,
    audioElement: null,
  }), false);
  assert.equal(pendingRequestIdRef.current, "generation-2");

  const audioElement = {
    play() {
      playCount += 1;
      return Promise.resolve();
    },
  };
  assert.equal(autoPlayModule.playRequestedAudioOnce({
    requestId: "generation-2",
    pendingRequestIdRef,
    audioElement,
  }), true);
  assert.equal(autoPlayModule.playRequestedAudioOnce({
    requestId: "generation-2",
    pendingRequestIdRef,
    audioElement,
  }), false);
  assert.equal(playCount, 1);
});
