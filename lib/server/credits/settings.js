import { DEFAULT_BILLING_SETTINGS } from "./constants";
import { getManagedChatRates } from "@/lib/server/models/service";

export async function getBillingSettings() {
  const settings = structuredClone(DEFAULT_BILLING_SETTINGS);
  settings.rates.chat = await getManagedChatRates();
  return settings;
}
