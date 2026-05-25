import { NextResponse } from "next/server";
import {
  createSession,
  normalizeUsername,
  serializeUser,
  setSessionCookie
} from "@/lib/auth";
import { ensureDatabase, getCollections } from "@/lib/db";

export async function POST(request: Request) {
  await ensureDatabase();
  const body = await request.json().catch(() => ({}));
  const username = normalizeUsername(body.username);
  const password = String(body.password ?? "");
  const { users } = await getCollections();
  const user = await users.findOne({ username });

  if (!user || user.password !== password) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  const token = await createSession(user._id);
  await setSessionCookie(token);

  return NextResponse.json({ user: serializeUser(user) });
}
