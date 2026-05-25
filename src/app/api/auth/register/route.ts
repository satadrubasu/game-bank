import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { ensureDatabase, getCollections } from "@/lib/db";
import { normalizeUsername } from "@/lib/auth";

export async function POST(request: Request) {
  await ensureDatabase();
  const { users } = await getCollections();
  const body = await request.json().catch(() => ({}));
  const username = normalizeUsername(body.username);
  const password = String(body.password ?? "");
  const adminUsername = normalizeUsername(process.env.ADMIN_USERNAME || "admin");

  if (!/^[a-z0-9_]{3,32}$/.test(username)) {
    return NextResponse.json(
      { error: "Use 3-32 lowercase letters, numbers, or underscores." },
      { status: 400 }
    );
  }

  if (username === adminUsername) {
    return NextResponse.json({ error: "That username is reserved." }, { status: 400 });
  }

  if (password.length < 3 || password.length > 64) {
    return NextResponse.json(
      { error: "Password must be between 3 and 64 characters." },
      { status: 400 }
    );
  }

  try {
    await users.insertOne({
      _id: new ObjectId(),
      username,
      password,
      role: "user",
      createdAt: new Date()
    });
  } catch {
    return NextResponse.json({ error: "Username is already taken." }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
