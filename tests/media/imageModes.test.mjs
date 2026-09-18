import assert from 'node:assert/strict';
import test from 'node:test';
import { useChatModeController as createChatModeController } from '../../lib/client/hooks/useChatModeController.js';

const SUNBURST = 'gpt-image-2.5-sunburst';
const FLARE = 'gpt-image-2.5-flare';

function controller(t, model, loading = false) {
  const state = {
    loading,
    model,
    messages: [{ role: 'user', content: '画一只猫' }],
    currentConversationId: 'image-conversation',
    setModel: t.mock.fn(),
    setCurrentConversationId: t.mock.fn(),
    setMessages: t.mock.fn(),
    setConfirmModalConfig: t.mock.fn(),
    setShowConfirmModal: t.mock.fn(),
    persistConversationModel: t.mock.fn(),
    userInterruptedRef: { current: false },
    lastTextModelRef: { current: null },
  };
  return { state, ...createChatModeController(state) };
}

for (const [from, to] of [[SUNBURST, FLARE], [FLARE, SUNBURST]]) {
  test(`switching ${from} to ${to} keeps the current conversation and saves the selected mode`, t => {
    const { state, requestModelChange } = controller(t, from);
    requestModelChange(to);
    assert.deepEqual(state.setModel.mock.calls.map(call => call.arguments), [[to]]);
    assert.deepEqual(state.persistConversationModel.mock.calls.map(call => call.arguments), [['image-conversation', to]]);
    assert.equal(state.setMessages.mock.callCount(), 0);
    assert.equal(state.setCurrentConversationId.mock.callCount(), 0);
    assert.equal(state.setShowConfirmModal.mock.callCount(), 0);
  });
}

test('image mode cannot change during generation; choosing Qwen still requests a new conversation', t => {
  const busy = controller(t, SUNBURST, true);
  busy.requestModelChange(FLARE);
  assert.equal(busy.state.setModel.mock.callCount(), 0);
  const ready = controller(t, SUNBURST);
  ready.requestModelChange('qwen-image-3.0-pro');
  assert.equal(ready.state.setModel.mock.callCount(), 0);
  assert.equal(ready.state.persistConversationModel.mock.callCount(), 0);
  assert.deepEqual(ready.state.setShowConfirmModal.mock.calls[0].arguments, [true]);
});
