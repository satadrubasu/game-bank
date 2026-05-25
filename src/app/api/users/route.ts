import { NextResponse } from "next/server";
import { ensureDatabase, getCollections } from "@/lib/db";

export async function GET() {
  await ensureDatabase();
  const { users } = await getCollections();
  const items = await users
    .find({})
    .project<{ username: string; role: string }>({ _id: 0, username: 1, role: 1 })
    .sort({ username: 1 })
    .toArray();

  return NextResponse.json({ items });
}
