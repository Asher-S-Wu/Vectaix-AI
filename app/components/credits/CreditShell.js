"use client";

import CreditBadge from "./CreditBadge";
import CreditHistoryModal from "./CreditHistoryModal";

export default function CreditShell({ className = "" }) {
  return (
    <>
      <CreditBadge className={className} />
      <CreditHistoryModal />
    </>
  );
}
