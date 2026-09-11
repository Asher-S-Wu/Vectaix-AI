import dbConnect from "@/lib/db";
import { ensureCreditTransactionIndexes } from "@/models/CreditTransaction";

export async function initializeCostRecording() {
  await dbConnect();
  await ensureCreditTransactionIndexes();
}
