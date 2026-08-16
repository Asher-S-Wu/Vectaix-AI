const MAX_SAMPLE_BYTES = 10 * 1024 * 1024;
const MIN_DURATION_SECONDS = 5;
const MAX_DURATION_SECONDS = 60;
const MIN_SAMPLE_RATE = 16_000;

const MIME_TYPES = Object.freeze({
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
});

const MPEG_1_LAYER_3_BITRATES = Object.freeze([
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
]);
const MPEG_2_LAYER_3_BITRATES = Object.freeze([
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
]);
const MPEG_SAMPLE_RATES = Object.freeze([44_100, 48_000, 32_000]);
const AAC_SAMPLE_RATES = Object.freeze([
  96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000,
  22_050, 16_000, 12_000, 11_025, 8_000, 7_350,
]);
const AAC_CHANNEL_COUNTS = Object.freeze({
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 8,
  11: 7,
});

const PCM_SUBFORMAT_GUID = Buffer.from([
  0x01, 0x00, 0x00, 0x00,
  0x00, 0x00,
  0x10, 0x00,
  0x80, 0x00,
  0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);

class AudioInspectionError extends Error {}

function fail(message) {
  throw new AudioInspectionError(message);
}

function ascii(buffer, start, end) {
  return buffer.subarray(start, end).toString("ascii");
}

function hasRange(buffer, start, length) {
  return Number.isSafeInteger(start)
    && Number.isSafeInteger(length)
    && start >= 0
    && length >= 0
    && start + length <= buffer.length;
}

function readSafeUInt64BE(buffer, offset, message) {
  if (!hasRange(buffer, offset, 8)) fail(message);
  const value = buffer.readBigUInt64BE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail(message);
  return Number(value);
}

function normalizeExtension(extension) {
  return String(extension || "").trim().toLowerCase().replace(/^\./, "");
}

function roundedDuration(value) {
  return Math.round(value * 1_000) / 1_000;
}

function validateSampleMetadata(result) {
  if (!Number.isFinite(result.durationSeconds) || result.durationSeconds <= 0) {
    fail("无法读取音频时长，请确认文件未损坏");
  }
  if (result.durationSeconds < MIN_DURATION_SECONDS) {
    fail("音频样本时长不能少于 5 秒");
  }
  if (result.durationSeconds > MAX_DURATION_SECONDS) {
    fail("音频样本时长不能超过 60 秒");
  }
  if (!Number.isInteger(result.sampleRate) || result.sampleRate < MIN_SAMPLE_RATE) {
    fail("音频样本采样率不能低于 16 kHz");
  }
  if (result.channels !== 1 && result.channels !== 2) {
    fail("音频样本只能使用单声道或双声道");
  }

  return {
    ...result,
    durationSeconds: roundedDuration(result.durationSeconds),
  };
}

function inspectWav(buffer) {
  if (
    buffer.length < 12
    || ascii(buffer, 0, 4) !== "RIFF"
    || ascii(buffer, 8, 12) !== "WAVE"
  ) {
    fail("文件内容与 WAV 格式不符");
  }

  const riffEnd = buffer.readUInt32LE(4) + 8;
  if (riffEnd !== buffer.length) {
    fail("WAV 文件长度信息不正确，文件可能已损坏");
  }

  let offset = 12;
  let format = null;
  let dataBytes = 0;
  let dataChunkCount = 0;

  while (offset < riffEnd) {
    if (!hasRange(buffer, offset, 8)) {
      fail("WAV 文件区块信息不完整");
    }

    const chunkType = ascii(buffer, offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkSize;
    if (!Number.isSafeInteger(dataEnd) || dataEnd > riffEnd) {
      fail("WAV 文件区块长度不正确");
    }

    if (chunkType === "fmt ") {
      if (format) fail("WAV 文件包含重复的音频格式区块");
      if (chunkSize < 16) fail("WAV 音频格式信息不完整");

      const audioFormat = buffer.readUInt16LE(dataStart);
      const channels = buffer.readUInt16LE(dataStart + 2);
      const sampleRate = buffer.readUInt32LE(dataStart + 4);
      const byteRate = buffer.readUInt32LE(dataStart + 8);
      const blockAlign = buffer.readUInt16LE(dataStart + 12);
      const bitDepth = buffer.readUInt16LE(dataStart + 14);

      if (audioFormat === 0xfffe) {
        if (chunkSize < 40) fail("WAV 扩展格式信息不完整");
        const extensionSize = buffer.readUInt16LE(dataStart + 16);
        const validBits = buffer.readUInt16LE(dataStart + 18);
        const subformat = buffer.subarray(dataStart + 24, dataStart + 40);
        if (
          extensionSize < 22
          || (validBits !== 0 && validBits !== 16)
          || !subformat.equals(PCM_SUBFORMAT_GUID)
        ) {
          fail("WAV 音频必须使用 16 位 PCM 编码");
        }
      } else if (audioFormat !== 1) {
        fail("WAV 音频必须使用 16 位 PCM 编码");
      }

      if (bitDepth !== 16) {
        fail("WAV 音频必须使用 16 位 PCM 编码");
      }
      if (
        channels < 1
        || sampleRate < 1
        || blockAlign !== channels * 2
        || byteRate !== sampleRate * blockAlign
      ) {
        fail("WAV 音频格式参数不正确");
      }

      format = {
        channels,
        sampleRate,
        blockAlign,
        bitDepth,
      };
    } else if (chunkType === "data") {
      dataChunkCount += 1;
      dataBytes += chunkSize;
    }

    const paddedEnd = dataEnd + (chunkSize % 2);
    if (paddedEnd > riffEnd) fail("WAV 文件区块填充不完整");
    offset = paddedEnd;
  }

  if (offset !== riffEnd) fail("WAV 文件结构不完整");
  if (!format) fail("WAV 文件缺少音频格式信息");
  if (dataChunkCount !== 1 || dataBytes === 0) {
    fail("WAV 文件必须包含一个有效的音频数据区块");
  }
  if (dataBytes % format.blockAlign !== 0) {
    fail("WAV 音频数据与声道信息不匹配");
  }

  return {
    mimeType: MIME_TYPES.wav,
    extension: "wav",
    durationSeconds: dataBytes / format.blockAlign / format.sampleRate,
    sampleRate: format.sampleRate,
    channels: format.channels,
    bitDepth: format.bitDepth,
  };
}

function readSynchsafeInteger(buffer, offset) {
  if (!hasRange(buffer, offset, 4)) fail("MP3 的 ID3 标签信息不完整");
  const bytes = [
    buffer[offset],
    buffer[offset + 1],
    buffer[offset + 2],
    buffer[offset + 3],
  ];
  if (bytes.some((value) => (value & 0x80) !== 0)) {
    fail("MP3 的 ID3 标签长度信息不正确");
  }
  return (
    (bytes[0] << 21)
    | (bytes[1] << 14)
    | (bytes[2] << 7)
    | bytes[3]
  );
}

function skipId3v2(buffer) {
  if (ascii(buffer, 0, 3) !== "ID3") return 0;
  if (buffer.length < 10) fail("MP3 的 ID3 标签信息不完整");

  const version = buffer[3];
  const revision = buffer[4];
  const flags = buffer[5];
  const allowedFlags = version === 2 ? 0xc0 : version === 3 ? 0xe0 : 0xf0;
  if (
    (version !== 2 && version !== 3 && version !== 4)
    || revision === 0xff
    || (flags & ~allowedFlags) !== 0
  ) {
    fail("MP3 的 ID3 标签版本无效");
  }

  const payloadSize = readSynchsafeInteger(buffer, 6);
  const hasFooter = version === 4 && (flags & 0x10) !== 0;
  const end = 10 + payloadSize + (hasFooter ? 10 : 0);
  if (end > buffer.length) fail("MP3 的 ID3 标签长度超过文件范围");

  if (hasFooter) {
    const footerStart = 10 + payloadSize;
    if (
      ascii(buffer, footerStart, footerStart + 3) !== "3DI"
      || buffer[footerStart + 3] !== version
      || buffer[footerStart + 4] !== revision
    ) {
      fail("MP3 的 ID3 标签尾部信息不正确");
    }
  }

  return end;
}

function parseMp3FrameHeader(buffer, offset) {
  if (!hasRange(buffer, offset, 4)) fail("MP3 音频帧信息不完整");
  const header = buffer.readUInt32BE(offset);
  if ((header >>> 21) !== 0x7ff) {
    fail("MP3 音频帧同步信息无效");
  }

  const versionBits = (header >>> 19) & 0x03;
  const layerBits = (header >>> 17) & 0x03;
  const bitrateIndex = (header >>> 12) & 0x0f;
  const sampleRateIndex = (header >>> 10) & 0x03;
  const padding = (header >>> 9) & 0x01;
  const channelMode = (header >>> 6) & 0x03;
  const emphasis = header & 0x03;

  if (versionBits === 1 || layerBits !== 1) {
    fail("MP3 音频必须使用有效的 Layer III 编码");
  }
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
    fail("MP3 音频帧的码率或采样率信息无效");
  }
  if (emphasis === 2) fail("MP3 音频帧参数无效");

  const isMpeg1 = versionBits === 3;
  const versionDivisor = isMpeg1 ? 1 : versionBits === 2 ? 2 : 4;
  const bitrateTable = isMpeg1
    ? MPEG_1_LAYER_3_BITRATES
    : MPEG_2_LAYER_3_BITRATES;
  const bitrate = bitrateTable[bitrateIndex] * 1_000;
  const sampleRate = MPEG_SAMPLE_RATES[sampleRateIndex] / versionDivisor;
  const samplesPerFrame = isMpeg1 ? 1_152 : 576;
  const frameLength = Math.floor(
    ((isMpeg1 ? 144 : 72) * bitrate) / sampleRate,
  ) + padding;

  if (frameLength < 4) fail("MP3 音频帧长度无效");

  return {
    versionBits,
    frameLength,
    sampleRate,
    channels: channelMode === 3 ? 1 : 2,
    samplesPerFrame,
  };
}

function inspectMp3(buffer) {
  if (buffer.length < 8) fail("文件内容与 MP3 格式不符");

  let offset = skipId3v2(buffer);
  let audioEnd = buffer.length;
  if (
    audioEnd - offset >= 128
    && ascii(buffer, audioEnd - 128, audioEnd - 125) === "TAG"
  ) {
    audioEnd -= 128;
  }

  let frameCount = 0;
  let totalSamples = 0;
  let streamSampleRate = null;
  let streamChannels = null;
  let streamVersion = null;

  while (offset < audioEnd) {
    const frame = parseMp3FrameHeader(buffer, offset);
    const frameEnd = offset + frame.frameLength;
    if (frameEnd > audioEnd) fail("MP3 音频帧长度超过文件范围");

    if (streamSampleRate === null) {
      streamSampleRate = frame.sampleRate;
      streamChannels = frame.channels;
      streamVersion = frame.versionBits;
    } else if (
      frame.sampleRate !== streamSampleRate
      || frame.channels !== streamChannels
      || frame.versionBits !== streamVersion
    ) {
      fail("MP3 音频流中的采样率或声道信息不一致");
    }

    totalSamples += frame.samplesPerFrame;
    frameCount += 1;
    offset = frameEnd;
  }

  if (offset !== audioEnd || frameCount < 2 || !streamSampleRate) {
    fail("文件中没有连续有效的 MP3 音频帧");
  }

  return {
    mimeType: MIME_TYPES.mp3,
    extension: "mp3",
    durationSeconds: totalSamples / streamSampleRate,
    sampleRate: streamSampleRate,
    channels: streamChannels,
    bitDepth: null,
  };
}

function readMp4Box(buffer, offset, limit) {
  if (limit - offset < 8) fail("M4A 文件区块信息不完整");

  const size32 = buffer.readUInt32BE(offset);
  const type = ascii(buffer, offset + 4, offset + 8);
  let headerSize = 8;
  let size;

  if (size32 === 1) {
    size = readSafeUInt64BE(buffer, offset + 8, "M4A 文件区块长度无效");
    headerSize = 16;
  } else if (size32 === 0) {
    size = limit - offset;
  } else {
    size = size32;
  }

  if (type === "uuid") headerSize += 16;
  if (size < headerSize || offset + size > limit) {
    fail("M4A 文件区块长度超过文件范围");
  }

  return {
    type,
    start: offset,
    dataStart: offset + headerSize,
    end: offset + size,
  };
}

function readMp4Boxes(buffer, start, end) {
  const boxes = [];
  let offset = start;
  while (offset < end) {
    const box = readMp4Box(buffer, offset, end);
    boxes.push(box);
    if (box.end <= offset) fail("M4A 文件区块长度无效");
    offset = box.end;
  }
  if (offset !== end) fail("M4A 文件结构不完整");
  return boxes;
}

function findBox(boxes, type) {
  return boxes.find((box) => box.type === type) || null;
}

function parseMp4TimeBox(buffer, box, label) {
  if (!box || box.end - box.dataStart < 20) {
    fail(`M4A 文件缺少有效的${label}时间信息`);
  }

  const version = buffer[box.dataStart];
  let timescale;
  let duration;
  if (version === 0) {
    if (box.end - box.dataStart < 24) {
      fail(`M4A 文件的${label}时间信息不完整`);
    }
    timescale = buffer.readUInt32BE(box.dataStart + 12);
    duration = buffer.readUInt32BE(box.dataStart + 16);
    if (duration === 0xffffffff) duration = null;
  } else if (version === 1) {
    if (box.end - box.dataStart < 36) {
      fail(`M4A 文件的${label}时间信息不完整`);
    }
    timescale = buffer.readUInt32BE(box.dataStart + 20);
    duration = readSafeUInt64BE(
      buffer,
      box.dataStart + 24,
      `M4A 文件的${label}时长信息无效`,
    );
    if (duration === Number.MAX_SAFE_INTEGER) duration = null;
  } else {
    fail(`M4A 文件的${label}时间版本不受支持`);
  }

  if (!timescale) fail(`M4A 文件的${label}时间基准无效`);
  return duration ? duration / timescale : null;
}

function readDescriptor(buffer, offset, limit) {
  if (offset >= limit) fail("M4A 的音频编码描述不完整");
  const tag = buffer[offset];
  let cursor = offset + 1;
  let length = 0;
  let completed = false;

  for (let index = 0; index < 4; index += 1) {
    if (cursor >= limit) fail("M4A 的音频编码描述长度不完整");
    const byte = buffer[cursor];
    cursor += 1;
    length = (length * 128) + (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      completed = true;
      break;
    }
  }

  if (!completed || cursor + length > limit) {
    fail("M4A 的音频编码描述长度无效");
  }

  return {
    tag,
    dataStart: cursor,
    end: cursor + length,
    next: cursor + length,
  };
}

function findDescriptor(buffer, start, end, tag) {
  let offset = start;
  while (offset < end) {
    const descriptor = readDescriptor(buffer, offset, end);
    if (descriptor.tag === tag) return descriptor;
    offset = descriptor.next;
  }
  return null;
}

function findAacDecoderConfig(buffer, esDescriptor) {
  if (esDescriptor.end - esDescriptor.dataStart < 3) {
    fail("M4A 的 AAC 音频描述不完整");
  }

  let offset = esDescriptor.dataStart + 2;
  const flags = buffer[offset];
  offset += 1;
  if ((flags & 0x80) !== 0) offset += 2;
  if ((flags & 0x40) !== 0) {
    if (offset >= esDescriptor.end) fail("M4A 的 AAC 地址描述不完整");
    const urlLength = buffer[offset];
    offset += 1 + urlLength;
  }
  if ((flags & 0x20) !== 0) offset += 2;
  if (offset > esDescriptor.end) fail("M4A 的 AAC 音频描述长度无效");

  return findDescriptor(buffer, offset, esDescriptor.end, 0x04);
}

function parseAacSpecificConfig(buffer, descriptor) {
  let bitOffset = descriptor.dataStart * 8;
  const bitEnd = descriptor.end * 8;

  function readBits(count) {
    if (bitOffset + count > bitEnd) fail("M4A 的 AAC 编码参数不完整");
    let value = 0;
    for (let index = 0; index < count; index += 1) {
      const byteOffset = Math.floor(bitOffset / 8);
      const shift = 7 - (bitOffset % 8);
      value = (value * 2) + ((buffer[byteOffset] >>> shift) & 1);
      bitOffset += 1;
    }
    return value;
  }

  function readAudioObjectType() {
    const base = readBits(5);
    return base === 31 ? 32 + readBits(6) : base;
  }

  function readSampleRate() {
    const index = readBits(4);
    if (index === 15) return readBits(24);
    const value = AAC_SAMPLE_RATES[index];
    if (!value) fail("M4A 的 AAC 采样率参数无效");
    return value;
  }

  let audioObjectType = readAudioObjectType();
  let sampleRate = readSampleRate();
  const channelConfiguration = readBits(4);

  if (audioObjectType === 5 || audioObjectType === 29) {
    sampleRate = readSampleRate();
    audioObjectType = readAudioObjectType();
  }
  if (!audioObjectType || !sampleRate) fail("M4A 的 AAC 编码参数无效");

  return {
    sampleRate,
    channels: AAC_CHANNEL_COUNTS[channelConfiguration] || null,
  };
}

function parseAacEsds(buffer, box) {
  if (box.end - box.dataStart < 6 || buffer[box.dataStart] !== 0) {
    fail("M4A 的 AAC 编码描述无效");
  }

  const descriptorStart = box.dataStart + 4;
  let decoderDescriptor;
  const esDescriptor = findDescriptor(
    buffer,
    descriptorStart,
    box.end,
    0x03,
  );
  if (esDescriptor) {
    decoderDescriptor = findAacDecoderConfig(buffer, esDescriptor);
  } else {
    decoderDescriptor = findDescriptor(
      buffer,
      descriptorStart,
      box.end,
      0x04,
    );
  }

  if (!decoderDescriptor || decoderDescriptor.end - decoderDescriptor.dataStart < 13) {
    fail("M4A 文件缺少 AAC 解码参数");
  }

  const objectType = buffer[decoderDescriptor.dataStart];
  const streamType = (buffer[decoderDescriptor.dataStart + 1] >>> 2) & 0x3f;
  if (![0x40, 0x66, 0x67, 0x68].includes(objectType) || streamType !== 5) {
    fail("M4A 音频必须使用 AAC 或 ALAC 编码");
  }

  const specificConfig = findDescriptor(
    buffer,
    decoderDescriptor.dataStart + 13,
    decoderDescriptor.end,
    0x05,
  );
  if (!specificConfig) fail("M4A 文件缺少 AAC 采样参数");
  return parseAacSpecificConfig(buffer, specificConfig);
}

function findNestedMp4Box(buffer, start, end, targetType, depth = 0) {
  const boxes = readMp4Boxes(buffer, start, end);
  for (const box of boxes) {
    if (box.type === targetType) return box;
    if (depth < 2 && (box.type === "wave" || box.type === "sinf")) {
      const nested = findNestedMp4Box(
        buffer,
        box.dataStart,
        box.end,
        targetType,
        depth + 1,
      );
      if (nested) return nested;
    }
  }
  return null;
}

function parseAlacConfig(buffer, box) {
  const payloadLength = box.end - box.dataStart;
  const configStart = payloadLength >= 28 ? box.dataStart + 4 : box.dataStart;
  if (box.end - configStart < 24) fail("M4A 的 ALAC 编码参数不完整");

  const bitDepth = buffer[configStart + 5];
  const channels = buffer[configStart + 9];
  const sampleRate = buffer.readUInt32BE(configStart + 20);
  if (
    ![16, 20, 24, 32].includes(bitDepth)
    || channels < 1
    || sampleRate < 1
  ) {
    fail("M4A 的 ALAC 编码参数无效");
  }

  return { bitDepth, channels, sampleRate };
}

function parseAudioSampleEntry(buffer, entry) {
  if (entry.end - entry.dataStart < 28) {
    fail("M4A 的音频轨道参数不完整");
  }

  const version = buffer.readUInt16BE(entry.dataStart + 8);
  let childStart;
  let channels = buffer.readUInt16BE(entry.dataStart + 16);
  let bitDepth = buffer.readUInt16BE(entry.dataStart + 18);
  let sampleRate = buffer.readUInt32BE(entry.dataStart + 24) / 65_536;

  if (version === 0) {
    childStart = entry.dataStart + 28;
  } else if (version === 1) {
    childStart = entry.dataStart + 44;
  } else if (version === 2) {
    childStart = entry.dataStart + 64;
    if (childStart > entry.end) fail("M4A 的音频轨道参数不完整");
    sampleRate = buffer.readDoubleBE(entry.dataStart + 32);
    channels = buffer.readUInt32BE(entry.dataStart + 40);
    bitDepth = buffer.readUInt32BE(entry.dataStart + 48);
  } else {
    fail("M4A 的音频轨道版本不受支持");
  }

  if (
    childStart > entry.end
    || !Number.isFinite(sampleRate)
    || sampleRate <= 0
    || Math.abs(sampleRate - Math.round(sampleRate)) > 0.001
    || channels < 1
  ) {
    fail("M4A 的音频轨道参数无效");
  }
  sampleRate = Math.round(sampleRate);

  if (entry.type === "mp4a") {
    const esds = findNestedMp4Box(
      buffer,
      childStart,
      entry.end,
      "esds",
    );
    if (!esds) fail("M4A 文件缺少 AAC 编码信息");
    const aac = parseAacEsds(buffer, esds);

    if (aac.channels && channels !== aac.channels) {
      fail("M4A 音频轨道的声道信息不一致");
    }
    if (
      aac.sampleRate !== sampleRate
      && aac.sampleRate * 2 !== sampleRate
      && sampleRate * 2 !== aac.sampleRate
    ) {
      fail("M4A 音频轨道的采样率信息不一致");
    }

    return {
      sampleRate: Math.max(sampleRate, aac.sampleRate),
      channels: aac.channels || channels,
      bitDepth: null,
    };
  }

  if (entry.type === "alac") {
    const alacBox = findNestedMp4Box(
      buffer,
      childStart,
      entry.end,
      "alac",
    );
    if (!alacBox) fail("M4A 文件缺少 ALAC 编码信息");
    const alac = parseAlacConfig(buffer, alacBox);
    if (
      channels !== alac.channels
      || sampleRate !== alac.sampleRate
      || (bitDepth && bitDepth !== alac.bitDepth)
    ) {
      fail("M4A 音频轨道的 ALAC 参数不一致");
    }
    return alac;
  }

  fail("M4A 音频必须使用 AAC 或 ALAC 编码");
}

function parseStsd(buffer, stsdBox) {
  if (stsdBox.end - stsdBox.dataStart < 8 || buffer[stsdBox.dataStart] !== 0) {
    fail("M4A 的音频采样描述无效");
  }

  const entryCount = buffer.readUInt32BE(stsdBox.dataStart + 4);
  if (entryCount < 1 || entryCount > 32) {
    fail("M4A 的音频采样描述数量无效");
  }

  let offset = stsdBox.dataStart + 8;
  let selectedEntry = null;
  for (let index = 0; index < entryCount; index += 1) {
    const entry = readMp4Box(buffer, offset, stsdBox.end);
    if (!selectedEntry && (entry.type === "mp4a" || entry.type === "alac")) {
      selectedEntry = entry;
    }
    offset = entry.end;
  }
  if (offset !== stsdBox.end) fail("M4A 的音频采样描述长度不一致");
  if (!selectedEntry) fail("M4A 文件中没有可用的 AAC 或 ALAC 音频轨道");

  return parseAudioSampleEntry(buffer, selectedEntry);
}

function parseM4aTrack(buffer, trakBox, movieDuration) {
  const trakChildren = readMp4Boxes(buffer, trakBox.dataStart, trakBox.end);
  const mdia = findBox(trakChildren, "mdia");
  if (!mdia) return null;

  const mdiaChildren = readMp4Boxes(buffer, mdia.dataStart, mdia.end);
  const hdlr = findBox(mdiaChildren, "hdlr");
  if (!hdlr || hdlr.end - hdlr.dataStart < 12) {
    fail("M4A 文件缺少轨道类型信息");
  }
  const handlerType = ascii(buffer, hdlr.dataStart + 8, hdlr.dataStart + 12);
  if (handlerType !== "soun") return { handlerType };

  const trackDuration = parseMp4TimeBox(
    buffer,
    findBox(mdiaChildren, "mdhd"),
    "音频轨道",
  );
  const minf = findBox(mdiaChildren, "minf");
  if (!minf) fail("M4A 文件缺少音频媒体信息");
  const minfChildren = readMp4Boxes(buffer, minf.dataStart, minf.end);
  const stbl = findBox(minfChildren, "stbl");
  if (!stbl) fail("M4A 文件缺少音频采样表");
  const stblChildren = readMp4Boxes(buffer, stbl.dataStart, stbl.end);
  const stsd = findBox(stblChildren, "stsd");
  if (!stsd) fail("M4A 文件缺少音频采样描述");

  return {
    handlerType,
    durationSeconds: trackDuration || movieDuration,
    ...parseStsd(buffer, stsd),
  };
}

function inspectM4a(buffer) {
  if (buffer.length < 16) fail("文件内容与 M4A 格式不符");
  const topLevelBoxes = readMp4Boxes(buffer, 0, buffer.length);
  const ftyp = topLevelBoxes[0];
  if (!ftyp || ftyp.type !== "ftyp" || ftyp.end - ftyp.dataStart < 8) {
    fail("文件内容与 M4A 格式不符");
  }
  if ((ftyp.end - ftyp.dataStart - 8) % 4 !== 0) {
    fail("M4A 文件品牌信息不完整");
  }

  const majorBrand = ascii(buffer, ftyp.dataStart, ftyp.dataStart + 4);
  if (!/^[\x20-\x7e]{4}$/.test(majorBrand)) {
    fail("M4A 文件品牌信息无效");
  }

  const moov = findBox(topLevelBoxes, "moov");
  const hasMediaData = topLevelBoxes.some(
    (box) => box.type === "mdat" && box.end > box.dataStart,
  );
  if (!moov || !hasMediaData) {
    fail("M4A 文件缺少媒体信息或音频数据");
  }

  const moovChildren = readMp4Boxes(buffer, moov.dataStart, moov.end);
  const mvhd = findBox(moovChildren, "mvhd");
  const movieDuration = mvhd
    ? parseMp4TimeBox(buffer, mvhd, "媒体")
    : null;

  const tracks = moovChildren.filter((box) => box.type === "trak");
  if (tracks.length === 0) fail("M4A 文件中没有媒体轨道");

  let audioTrack = null;
  for (const track of tracks) {
    const parsed = parseM4aTrack(buffer, track, movieDuration);
    if (!parsed) continue;
    if (parsed.handlerType === "vide") {
      fail("M4A 音频文件不能包含视频轨道");
    }
    if (parsed.handlerType === "soun") {
      if (audioTrack) fail("M4A 文件只能包含一条音频轨道");
      audioTrack = parsed;
    }
  }

  if (!audioTrack || !audioTrack.durationSeconds) {
    fail("M4A 文件中没有可读取的音频轨道");
  }

  return {
    mimeType: MIME_TYPES.m4a,
    extension: "m4a",
    durationSeconds: audioTrack.durationSeconds,
    sampleRate: audioTrack.sampleRate,
    channels: audioTrack.channels,
    bitDepth: audioTrack.bitDepth,
  };
}

function inspectOggOpus(buffer) {
  if (buffer.length < 47 || ascii(buffer, 0, 4) !== "OggS") {
    fail("文件内容与 OGG 格式不符");
  }

  let offset = 0;
  let streamSerial = null;
  let lastGranule = null;
  let channels = null;
  let preSkip = null;
  let pageCount = 0;
  while (offset < buffer.length) {
    if (!hasRange(buffer, offset, 27) || ascii(buffer, offset, offset + 4) !== "OggS") {
      fail("OGG 音频分页结构无效");
    }
    if (buffer[offset + 4] !== 0) fail("OGG 音频版本不受支持");
    const segmentCount = buffer[offset + 26];
    if (!hasRange(buffer, offset + 27, segmentCount)) {
      fail("OGG 音频分页信息不完整");
    }
    let bodySize = 0;
    for (let index = 0; index < segmentCount; index += 1) {
      bodySize += buffer[offset + 27 + index];
    }
    const pageSize = 27 + segmentCount + bodySize;
    if (!hasRange(buffer, offset, pageSize)) fail("OGG 音频分页长度无效");

    if (pageCount === 0) {
      const headerType = buffer[offset + 5];
      const pageSequence = buffer.readUInt32LE(offset + 18);
      const firstPacketBytes = segmentCount ? buffer[offset + 27] : 0;
      const bodyStart = offset + 27 + segmentCount;
      if (
        (headerType & 0x02) === 0
        || pageSequence !== 0
        || firstPacketBytes < 19
        || !hasRange(buffer, bodyStart, 19)
        || ascii(buffer, bodyStart, bodyStart + 8) !== "OpusHead"
        || buffer[bodyStart + 8] !== 1
      ) {
        fail("OGG 音频必须使用有效的 Opus 编码");
      }
      channels = buffer[bodyStart + 9];
      preSkip = buffer.readUInt16LE(bodyStart + 10);
      if (channels < 1 || channels > 8) {
        fail("OGG Opus 音频声道信息无效");
      }
    }

    const serial = buffer.readUInt32LE(offset + 14);
    if (streamSerial === null) streamSerial = serial;
    if (serial !== streamSerial) fail("OGG 音频不能包含多个逻辑音频流");

    const granule = buffer.readBigUInt64LE(offset + 6);
    if (granule !== 0xffffffffffffffffn) lastGranule = granule;
    pageCount += 1;
    offset += pageSize;
  }

  if (
    offset !== buffer.length
    || pageCount < 2
    || lastGranule === null
    || channels === null
    || preSkip === null
  ) {
    fail("OGG Opus 音频内容不完整");
  }
  if (lastGranule > BigInt(Number.MAX_SAFE_INTEGER)) fail("OGG Opus 音频时长无效");
  const playableSamples = Number(lastGranule) - preSkip;
  if (playableSamples <= 0) fail("OGG Opus 音频没有有效内容");

  return {
    mimeType: MIME_TYPES.ogg,
    extension: "ogg",
    durationSeconds: playableSamples / 48_000,
    sampleRate: 48_000,
    channels,
    bitDepth: null,
  };
}

function parseAudioMetadata(input, extension) {
  if (!Buffer.isBuffer(input) || input.length === 0) {
    fail("音频内容为空或无法读取");
  }
  const normalizedExtension = normalizeExtension(extension);
  if (!MIME_TYPES[normalizedExtension]) fail("不支持的音频格式");
  if (normalizedExtension === "wav") return inspectWav(input);
  if (normalizedExtension === "mp3") return inspectMp3(input);
  if (normalizedExtension === "ogg") return inspectOggOpus(input);
  return inspectM4a(input);
}

export function inspectAudioMetadata(input, extension) {
  try {
    const parsed = parseAudioMetadata(input, extension);
    if (!Number.isFinite(parsed.durationSeconds) || parsed.durationSeconds <= 0) {
      fail("无法读取音频时长，请确认文件未损坏");
    }
    return {
      ...parsed,
      durationSeconds: roundedDuration(parsed.durationSeconds),
    };
  } catch (error) {
    if (error instanceof AudioInspectionError) throw new Error(error.message);
    throw new Error("无法解析音频，请确认文件格式正确且未损坏");
  }
}

export function inspectVoiceSample(input, extension) {
  try {
    if (!Buffer.isBuffer(input) || input.length === 0) {
      fail("音频样本内容为空或无法读取");
    }
    if (input.length > MAX_SAMPLE_BYTES) {
      fail("音频样本不能超过 10 MB");
    }

    const normalizedExtension = normalizeExtension(extension);
    if (!MIME_TYPES[normalizedExtension]) {
      fail("声音复刻仅支持 WAV、MP3 或 M4A 格式");
    }

    const parsed = parseAudioMetadata(input, normalizedExtension);
    return validateSampleMetadata(parsed);
  } catch (error) {
    if (error instanceof AudioInspectionError) {
      throw new Error(error.message);
    }
    throw new Error("无法解析音频样本，请确认文件格式正确且未损坏");
  }
}
