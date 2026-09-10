import BackupSchedule from '@/models/BackupSchedule';
import { workbenchRoute, readBody } from '@/lib/server/workbench/apiHelpers';
import { saveSchedule } from '@/lib/server/backups/service';
export function GET(req) { return workbenchRoute(req, async userId => Response.json({ schedules: await BackupSchedule.find({ userId }).sort({ createdAt: 1 }).lean() })); }
export function POST(req) { return workbenchRoute(req, async userId => Response.json({ schedule: await saveSchedule(userId, await readBody(req)) })); }
