const object = value => value && typeof value === 'object' && !Array.isArray(value);
const name = value => typeof value === 'string' && /^[\w-]{1,128}$/.test(value);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const textContent = (value, types) => typeof value === 'string' || (Array.isArray(value) && value.every(part => {
  if (!object(part) || !types.includes(part.type)) return false;
  if (part.type === 'input_image') return typeof part.image_url === 'string' && Boolean(part.image_url);
  if (part.type === 'image_url') return typeof part.image_url?.url === 'string' && Boolean(part.image_url.url);
  if (part.type === 'refusal') return typeof part.refusal === 'string';
  return typeof part.text === 'string';
}));

function checkResponses(items, invalid) {
  const pending = new Set(), used = new Set();
  for (const item of items) {
    if (!object(item)) invalid();
    if (item.type === 'function_call_output') {
      if (!pending.delete(item.call_id) || !textContent(item.output, ['input_text', 'input_image'])) invalid();
    } else if (item.type === 'function_call') {
      if (!id(item.call_id) || used.has(item.call_id) || !name(item.name) || typeof item.arguments !== 'string') invalid();
      used.add(item.call_id); pending.add(item.call_id);
    } else if (item.type === 'reasoning') {
      if (pending.size || (item.content !== undefined && !textContent(item.content, ['reasoning_text']))
        || (item.summary !== undefined && !textContent(item.summary, ['summary_text']))
        || (item.encrypted_content !== undefined && item.encrypted_content !== null && typeof item.encrypted_content !== 'string')) invalid();
    } else if (item.type === 'message' || item.type === undefined) {
      if (pending.size || !['assistant', 'user'].includes(item.role) || !textContent(item.content, item.role === 'user' ? ['input_text', 'input_image'] : ['output_text', 'refusal'])) invalid();
    } else invalid();
  }
  if (pending.size || items.at(-1).role !== 'assistant') invalid();
}

function checkChat(items, invalid) {
  const pending = new Set(), used = new Set();
  for (const item of items) {
    if (!object(item)) invalid();
    if (item.role === 'tool') {
      if (!pending.delete(item.tool_call_id) || typeof item.content !== 'string') invalid();
      continue;
    }
    if (pending.size || !['assistant', 'user'].includes(item.role)) invalid();
    if (item.content !== null && !textContent(item.content, ['text', 'image_url'])) invalid();
    if (item.reasoning_content !== undefined && typeof item.reasoning_content !== 'string') invalid();
    if (item.tool_calls !== undefined) {
      if (item.role !== 'assistant' || !Array.isArray(item.tool_calls)) invalid();
      for (const call of item.tool_calls) {
        if (call?.type !== 'function' || !id(call.id) || used.has(call.id) || !name(call.function?.name) || typeof call.function?.arguments !== 'string') invalid();
        pending.add(call.id); used.add(call.id);
      }
    }
  }
  if (pending.size || items.at(-1).role !== 'assistant' || items.at(-1).tool_calls?.length) invalid();
}

function checkMessages(items, invalid) {
  const pending = new Set(), used = new Set();
  function contentValid(block) {
    if (!object(block)) return false;
    if (block.type === 'text') return typeof block.text === 'string';
    if (block.type === 'image') return object(block.source) && ((block.source.type === 'base64' && typeof block.source.data === 'string' && /^image\//.test(block.source.media_type)) || (block.source.type === 'url' && typeof block.source.url === 'string'));
    return false;
  }
  for (const item of items) {
    if (!object(item) || !['assistant', 'user'].includes(item.role)) invalid();
    if (typeof item.content === 'string') { if (pending.size) invalid(); continue; }
    if (!Array.isArray(item.content)) invalid();
    if (pending.size && item.role !== 'user') invalid();
    const awaitingResults = pending.size > 0;
    for (const block of item.content) {
      if (block?.type === 'tool_result') {
        if (item.role !== 'user' || !pending.delete(block.tool_use_id) || !(typeof block.content === 'string' || (Array.isArray(block.content) && block.content.every(contentValid)))) invalid();
      } else if (block?.type === 'tool_use') {
        if (item.role !== 'assistant' || !id(block.id) || used.has(block.id) || !name(block.name) || !object(block.input)) invalid();
        used.add(block.id); pending.add(block.id);
      } else if (block?.type === 'thinking') {
        if (item.role !== 'assistant' || typeof block.thinking !== 'string' || typeof block.signature !== 'string') invalid();
      } else if (block?.type === 'redacted_thinking') {
        if (item.role !== 'assistant' || typeof block.data !== 'string') invalid();
      } else if (!contentValid(block)) invalid();
    }
    if (awaitingResults && pending.size) invalid();
  }
  if (pending.size || items.at(-1).role !== 'assistant') invalid();
}

export function sanitizeNativeProviderState(value) {
  const result = {};
  if (!object(value)) return result;
  for (const [protocol, validate] of Object.entries({ responses: checkResponses, chat: checkChat, messages: checkMessages })) {
    if (value[protocol] === undefined) continue;
    const state = value[protocol];
    const invalid = () => { throw new Error(`providerState.${protocol} invalid`); };
    if (!object(state) || typeof state.model !== 'string' || !/^[\w./:@+-]{1,200}$/.test(state.model)
      || typeof state.providerId !== 'string' || !/^[\w-]{1,64}$/.test(state.providerId) || !Array.isArray(state.items) || !state.items.length) invalid();
    validate(state.items, invalid);
    result[protocol] = { model: state.model, providerId: state.providerId, items: structuredClone(state.items) };
  }
  return result;
}
