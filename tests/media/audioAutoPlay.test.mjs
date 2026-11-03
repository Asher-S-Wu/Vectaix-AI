import assert from "node:assert/strict";
import test from "node:test";
import { playRequestedAudioOnce } from "../../lib/media/client/audioAutoPlay.mjs";

test("每次播放请求只执行一次，旧播放器挂载时保留新的播放请求", () => {
  const pendingRequestIdRef = { current: "blob:preview-1" };
  let plays = 0;
  const mount = requestId => playRequestedAudioOnce({
    requestId,
    pendingRequestIdRef,
    audioElement: { play() { plays += 1; return Promise.resolve(); } },
  });

  assert.equal(mount("blob:preview-1"), true);
  assert.equal(mount("blob:preview-1"), false);
  assert.equal(plays, 1);

  pendingRequestIdRef.current = "blob:preview-2";
  assert.equal(mount("blob:preview-1"), false);
  assert.equal(pendingRequestIdRef.current, "blob:preview-2");
  assert.equal(mount("blob:preview-2"), true);
  assert.equal(mount("blob:preview-2"), false);
  assert.equal(plays, 2);
});

test("播放器稍后挂载时执行待播放请求", () => {
  const pendingRequestIdRef = { current: "generation-2" };
  let playCount = 0;

  assert.equal(playRequestedAudioOnce({
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
  assert.equal(playRequestedAudioOnce({
    requestId: "generation-2",
    pendingRequestIdRef,
    audioElement,
  }), true);
  assert.equal(playRequestedAudioOnce({
    requestId: "generation-2",
    pendingRequestIdRef,
    audioElement,
  }), false);
  assert.equal(playCount, 1);
});
