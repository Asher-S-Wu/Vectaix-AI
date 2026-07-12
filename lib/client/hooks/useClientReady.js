"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

export function useClientReady() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
