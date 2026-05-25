import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { ensureDatabase, getCollections, type UserDoc } from "./db";
import { playerDisplayName } from "./seats";

export const SESSION_COOKIE = "game_bank_session";

export type PublicUser = {
  id: string;
  username: string;
  role: UserDoc["role"];
};

export function normalizeUsername(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function serializeUser(user: UserDoc): PublicUser {
  return {
    id: user._id.toString(),
    username: playerDisplayName(user),
    role: user.role
  };
}

export async function createSession(userId: ObjectId): Promise<string> {
  await ensureDatabase();
  const { sessions } = await getCollections();
  const token = randomUUID();
  await sessions.insertOne({
    _id: new ObjectId(),
    token,
    userId,
    createdAt: new Date()
  });
  return token;
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: 60 * 60 * 24 * 14
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const { sessions } = await getCollections();
    await sessions.deleteOne({ token });
  }
  cookieStore.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<UserDoc | null> {
  await ensureDatabase();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }

  const { sessions, users } = await getCollections();
  const session = await sessions.findOne({ token });
  if (!session) {
    return null;
  }

  return users.findOne({ _id: session.userId });
}

export async function requireUser(): Promise<UserDoc> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Unauthorized");
  }
  return user;
}
