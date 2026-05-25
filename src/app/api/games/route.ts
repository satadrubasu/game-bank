import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { requireUser } from "@/lib/auth";
import { ensureDatabase, getCollections } from "@/lib/db";
import { parsePoints } from "@/lib/money";
import { buildBankSeat, buildGameSeats } from "@/lib/seats";
import { buildAppState } from "@/lib/state";

export async function POST(request: Request) {
  await ensureDatabase();
  const user = await requireUser();
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Only admin can create games." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const rawName = String(body.name ?? "").trim();
  if (rawName.length > 12) {
    return NextResponse.json({ error: "Game name must be 12 characters or fewer." }, { status: 400 });
  }

  const name = rawName || `Game ${Date.now().toString().slice(-6)}`;
  const maxPlayers = Number(body.maxPlayers);
  const initialFunds = parsePoints(body.initialFunds);
  const centralBankEnabled = Boolean(body.centralBankEnabled);

  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 12) {
    return NextResponse.json({ error: "Max players must be between 2 and 12." }, { status: 400 });
  }

  if (!initialFunds) {
    return NextResponse.json({ error: "Initial points must be a positive whole number." }, { status: 400 });
  }

  const { users, games, wallets } = await getCollections();
  const gameId = new ObjectId();
  const createdAt = new Date();
  const seats = buildGameSeats({
    gameId,
    maxPlayers,
    initialFunds,
    createdAt
  });
  const bank = centralBankEnabled ? buildBankSeat({ gameId, createdAt }) : null;

  await games.insertOne({
    _id: gameId,
    name,
    status: "open",
    maxPlayers,
    initialFunds,
    centralBankEnabled,
    ...(bank ? { bankUserId: bank.user._id } : {}),
    createdBy: user._id,
    createdAt
  });
  await users.insertMany(bank ? [...seats.users, bank.user] : seats.users);
  await wallets.insertMany(bank ? [...seats.wallets, bank.wallet] : seats.wallets);

  return NextResponse.json(await buildAppState(user));
}
