import { WebBrowsingApiName } from "@/lib/server/webBrowsing/types";

function normalizeMaxRounds(maxRounds) {
  if (!Number.isFinite(maxRounds)) return 0;
  return Math.max(0, Math.floor(maxRounds));
}

export function createWebBrowsingRoundController({ maxRounds } = {}) {
  const safeMaxRounds = normalizeMaxRounds(maxRounds);
  let currentRound = 0;
  let currentRoundHasSearch = false;
  let currentRoundHasReader = false;

  const getAvailableToolApiNames = () => {
    if (safeMaxRounds <= 0) return [];

    if (currentRound === 0) {
      return [WebBrowsingApiName.search];
    }

    if (currentRoundHasSearch && !currentRoundHasReader) {
      const apiNames = [WebBrowsingApiName.crawlSinglePage];
      if (currentRound < safeMaxRounds) {
        apiNames.push(WebBrowsingApiName.search);
      }
      return apiNames;
    }

    if (currentRound < safeMaxRounds) {
      return [WebBrowsingApiName.search];
    }

    return [];
  };

  const reserve = (apiName) => {
    if (apiName === WebBrowsingApiName.search) {
      if (currentRound >= safeMaxRounds) {
        return { allowed: false, round: currentRound };
      }

      currentRound += 1;
      currentRoundHasSearch = true;
      currentRoundHasReader = false;

      return { allowed: true, round: currentRound };
    }

    if (apiName === WebBrowsingApiName.crawlSinglePage || apiName === WebBrowsingApiName.crawlMultiPages) {
      if (currentRound === 0 || !currentRoundHasSearch || currentRoundHasReader) {
        return { allowed: false, round: currentRound };
      }

      currentRoundHasReader = true;
      return { allowed: true, round: currentRound };
    }

    return { allowed: false, round: currentRound };
  };

  const getRoundState = () => ({
    currentRound,
    currentRoundHasSearch,
    currentRoundHasReader,
    maxRounds: safeMaxRounds,
  });

  return {
    getAvailableToolApiNames,
    getRoundState,
    reserve,
  };
}
