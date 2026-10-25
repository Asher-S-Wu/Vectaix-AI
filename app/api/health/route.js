import { localizedRoute } from '@/lib/server/localizedRoute';
import mongoose from "mongoose";
import dbConnect from "@/lib/db";
import { ensureStorageReady } from "@/lib/server/storage/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function GETHandler() {
  const checks = { database: "error", storage: "error" };
  try {
    await dbConnect();
    await mongoose.connection.db.admin().ping();
    checks.database = "ok";
  } catch (error) {
    console.error("[Health] database:", error);
  }
  try {
    await ensureStorageReady();
    checks.storage = "ok";
  } catch (error) {
    console.error("[Health] storage:", error);
  }
  const ok = Object.values(checks).every((value) => value === "ok");
  return Response.json({ status: ok ? "ok" : "unhealthy", checks }, { status: ok ? 200 : 503 });
}

export const GET = localizedRoute(GETHandler);
