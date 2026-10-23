import { MEDIA_MODELS } from '@/lib/media/shared/models';

export function normalizeModelId(model) { return typeof model==='string'?model.trim():model; }
export function getModelConfig(id) { return MEDIA_MODELS.find(model=>model.id===normalizeModelId(id)) || null; }
export function isMediaGenerationModel(id) { return Boolean(getModelConfig(id)?.mediaType); }
export function isImageGenerationModel(id) { return getModelConfig(id)?.mediaType==='image'; }
