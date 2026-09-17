import assert from 'node:assert/strict';
import test from 'node:test';
import * as imageModels from '../../lib/media/shared/models.js';

const QWEN = 'qwen-image-3.0-pro';
const SUNBURST = 'gpt-image-2.5-sunburst';
const FLARE = 'gpt-image-2.5-flare';
const MB = 1024 * 1024;
const image = (size = 1024, name = 'reference.png', type = 'image/png') => ({ name, type, size });
const rejectsOptions = (options) => assert.throws(
  () => imageModels.validateImageOptions(options),
  (error) => error.status === 400,
);
const rejectsReferences = (model, images, options) => assert.throws(
  () => imageModels.validateImageReferences(model, images, options),
  (error) => error.status === 400,
);

test('Qwen keeps automatic sizing and excludes quality from its validated options', () => {
  assert.equal(typeof imageModels.validateImageOptions, 'function');
  assert.deepEqual(imageModels.validateImageOptions({ model: QWEN, size: 'auto' }), {
    model: QWEN,
    size: 'auto',
  });
  rejectsOptions({ model: QWEN, size: 'auto', quality: 'high' });
  rejectsOptions({ model: QWEN, size: '2048x2048' });
});

test('Micu models accept every documented size and quality without replacing supplied values', () => {
  assert.equal(typeof imageModels.validateImageOptions, 'function');
  for (const model of [SUNBURST, FLARE]) {
    for (const size of ['1024x1024', '1280x720', '720x1280', '1024x1536', '1536x1024', '2048x2048', '2048x1152', '1152x2048', '3840x2160', '2160x3840']) {
      for (const quality of ['auto', 'low', 'medium', 'high', 'xhigh', 'max']) {
        assert.deepEqual(imageModels.validateImageOptions({ model, size, quality }), { model, size, quality });
      }
    }
  }
});

test('invalid or missing image options are rejected instead of using defaults', () => {
  assert.equal(typeof imageModels.validateImageOptions, 'function');
  for (const options of [
    {},
    { model: 'unknown', size: '1024x1024', quality: 'auto' },
    { model: QWEN },
    { model: SUNBURST, size: 'auto', quality: 'auto' },
    { model: FLARE, size: '1024x1024' },
    { model: FLARE, size: '1024x1024', quality: 'ultra' },
  ]) rejectsOptions(options);
  assert.throws(() => imageModels.getImageModelConfig('unknown'), (error) => error.status === 400);
});

test('each model configuration supplies a valid explicit initial selection', () => {
  assert.equal(typeof imageModels.getImageModelConfig, 'function');
  for (const model of [QWEN, SUNBURST, FLARE]) {
    const config = imageModels.getImageModelConfig(model);
    const validated = imageModels.validateImageOptions({
      model,
      size: config.defaultSize,
      quality: config.defaultQuality,
    });
    assert.equal(validated.size, model === QWEN ? 'auto' : '1024x1024');
    assert.equal(validated.quality, model === QWEN ? undefined : 'auto');
  }
});

test('Qwen accepts three 10 MB references and rejects the fourth or an oversized file', () => {
  assert.equal(typeof imageModels.validateImageReferences, 'function');
  assert.doesNotThrow(() => imageModels.validateImageReferences(QWEN, [image(10 * MB), image(10 * MB), image(10 * MB)]));
  rejectsReferences(QWEN, [image(), image(), image(), image()]);
  rejectsReferences(QWEN, [image(10 * MB + 1)]);
});

test('Micu enforces ten references, 4 MB per file and 8 MB for the combined files', () => {
  assert.equal(typeof imageModels.validateImageReferences, 'function');
  for (const model of [SUNBURST, FLARE]) {
    assert.doesNotThrow(() => imageModels.validateImageReferences(model, Array.from({ length: 10 }, () => image())));
    assert.doesNotThrow(() => imageModels.validateImageReferences(model, [image(4 * MB), image(4 * MB)]));
    rejectsReferences(model, Array.from({ length: 11 }, () => image()));
    rejectsReferences(model, [image(4 * MB + 1)]);
    rejectsReferences(model, [image(4 * MB), image(4 * MB), image(1)]);
  }
});

test('generation permits no references while editing requires at least one', () => {
  assert.equal(typeof imageModels.validateImageReferences, 'function');
  for (const model of [QWEN, SUNBURST, FLARE]) {
    assert.doesNotThrow(() => imageModels.validateImageReferences(model, []));
    rejectsReferences(model, [], { requireImages: true });
    assert.doesNotThrow(() => imageModels.validateImageReferences(model, [image()], { requireImages: true }));
  }
});

test('Micu accepts PNG, JPEG and WebP but rejects Qwen-only image formats', () => {
  assert.equal(typeof imageModels.validateImageReferences, 'function');
  for (const [name, type] of [['reference.png', 'image/png'], ['reference.JPG', 'image/jpeg'], ['reference.webp', 'image/webp']]) {
    assert.doesNotThrow(() => imageModels.validateImageReferences(SUNBURST, [image(1024, name, type)]));
  }
  for (const [name, type] of [['reference.gif', 'image/gif'], ['reference.bmp', 'image/bmp'], ['reference.tiff', 'image/tiff']]) {
    assert.doesNotThrow(() => imageModels.validateImageReferences(QWEN, [image(1024, name, type)]));
    rejectsReferences(SUNBURST, [image(1024, name, type)]);
  }
});

test('reference metadata must include a valid filename and positive file size', () => {
  assert.equal(typeof imageModels.validateImageReferences, 'function');
  for (const invalidImage of [
    null,
    { type: 'image/png', size: 1024 },
    image(0),
    image(-1),
    image(Number.NaN),
    image(1.5),
    image('1024'),
    image(1024, '   '),
    image(1024, 'png'),
    image(1024, 'reference.svg', 'image/png'),
    image(1024, 'reference.png', 'text/plain'),
  ]) rejectsReferences(SUNBURST, [invalidImage]);
  assert.doesNotThrow(() => imageModels.validateImageReferences(QWEN, [image(1024, 'reference.PNG', '')]));
  assert.doesNotThrow(() => imageModels.validateImageReferences(SUNBURST, [new File(['png'], 'reference.png', { type: 'image/png' })]));
});
