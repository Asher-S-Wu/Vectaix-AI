import { MEDIA_MODELS } from '@/lib/media/shared/models';

export let CHAT_MODELS=[...MEDIA_MODELS];
export let DEFAULT_MODEL=null;
export let MODEL_GROUP_ORDER=[];
export let MODEL_GROUP_TITLES={};

export function installModelCatalog({models,defaultModelId}) {
  CHAT_MODELS=[...models,...MEDIA_MODELS];
  DEFAULT_MODEL=defaultModelId;
  MODEL_GROUP_ORDER=[...new Set(models.map(model=>model.group))];
  MODEL_GROUP_TITLES=Object.fromEntries(MODEL_GROUP_ORDER.map(group=>[group,group]));
}
export function normalizeModelId(model) { return typeof model==='string'?model.trim():model; }
export function getModelConfig(id) { return CHAT_MODELS.find(model=>model.id===normalizeModelId(id)) || null; }
export function getModelProvider(id) { return getModelConfig(id)?.provider || ''; }
export function isPrimaryChatModelId(id) { return Boolean(getModelConfig(id)); }
export function isMediaGenerationModel(id) { return Boolean(getModelConfig(id)?.mediaType); }
export function isImageGenerationModel(id) { return getModelConfig(id)?.mediaType==='image'; }
export function resolveUsableModelId(id) {
  const normalized=normalizeModelId(id);
  if (!normalized) return DEFAULT_MODEL;
  return normalized;
}
export function getSelectableChatModels() { return CHAT_MODELS.filter(model=>!model.mediaType); }
export function modelSupportsAvailableInput(id,inputType) { return Boolean(getModelConfig(id)?.nativeInputs?.includes(inputType)); }
export function getModelAttachmentSupport(id) {
  const supportsImages=modelSupportsAvailableInput(id,'image');
  const supportsAudio=modelSupportsAvailableInput(id,'audio');
  const supportsVideo=modelSupportsAvailableInput(id,'video');
  return {supportsImages,supportsAudio,supportsVideo,supportsFilePicker:supportsImages||supportsAudio||supportsVideo};
}
