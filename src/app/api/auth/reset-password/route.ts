import { NextResponse } from "next/server";
import { ensureDatabase, getCollections } from "@/lib/db";
import { normalizeUsername } from "@/lib/auth";

export async function POST(request: Request) {
  await ensureDatabase();
  const body = await request.json().catch(() => ({}));
  const username = normalizeUsername(body.username);
  const password = String(body.password ?? "");
  const adminUsername = normalizeUsername(process.env.ADMIN_USERNAME || "admin");

  if (username === adminUsername) {
    return NextResponse.json(
      { error: "Admin password is controlled by the compose environment." },
      { status: 400 }
    );
  }

  if (password.length < 3 || password.length > 64) {
    return NextResponse.json(
      { error: "Password must be between 3 and 64 characters." },
      { status: 400 }
    );
  }

  const { users } = await getCollections();
  const result = await users.updateOne({ username, role: "user" }, { $set: { password } });

  if (result.matchedCount === 0) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
