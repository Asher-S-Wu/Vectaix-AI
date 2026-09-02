import { pointsFromCny, pointsFromUsd } from "./pricing";
import { POINTS_PER_CNY } from "./constants";

export function getPublicCreditPricing(settings) {
  const rates = settings.rates;
  return {
    pricingDate: settings.pricingDate,
    qwenImage: {
      output1K: pointsFromCny(rates.qwenImage.outputCny["1K"], settings),
      output2K: pointsFromCny(rates.qwenImage.outputCny["2K"], settings),
      inputImage: pointsFromCny(rates.qwenImage.inputImageCny, settings),
    },
    happyHorse: {
      generationRawPointsPerSecond: Object.fromEntries(
        Object.entries(rates.happyHorse.generationCnyPerSecond)
          .map(([key, value]) => [key, value * settings.costMultiplier * POINTS_PER_CNY]),
      ),
      editRawPointsPerSecond: Object.fromEntries(
        Object.entries(rates.happyHorse.editCnyPerSecond)
          .map(([key, value]) => [key, value * settings.costMultiplier * POINTS_PER_CNY]),
      ),
    },
    qwenTts: {
      per10000Characters: pointsFromCny(rates.qwenTts.cnyPer10000Characters, settings),
      voiceClone: pointsFromUsd(rates.qwenTts.voiceCloneUsd, settings),
    },
    minimaxTts: {
      hdPer10000Characters: pointsFromCny(rates.minimaxTts.cnyPer10000Characters.hd, settings),
      turboPer10000Characters: pointsFromCny(rates.minimaxTts.cnyPer10000Characters.turbo, settings),
      firstVoiceClone: pointsFromCny(rates.minimaxTts.firstVoiceCloneCny, settings),
    },
    seedAudio: {
      perMinute: pointsFromCny(rates.seedAudio.cnyPerMinute, settings),
      maximum120Seconds: pointsFromCny(rates.seedAudio.cnyPerMinute * 2, settings),
    },
    mediaKit: {
      perMinute: pointsFromCny(rates.mediaKit.cnyPerMinute, settings),
    },
  };
}
