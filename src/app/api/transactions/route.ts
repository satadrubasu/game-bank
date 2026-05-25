import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { requireUser } from "@/lib/auth";
import { ensureDatabase, getCollections, toObjectId } from "@/lib/db";
import { parsePoints } from "@/lib/money";
import { isBankWallet, isOccupiedWallet } from "@/lib/seats";
import { buildAppState } from "@/lib/state";

export async function POST(request: Request) {
  await ensureDatabase();
  const user = await requireUser();
  if (user.role !== "user") {
    return NextResponse.json({ error: "Only players can create transfers." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const gameId = toObjectId(String(body.gameId ?? ""));
  const targetUserId = toObjectId(String(body.targetUserId ?? ""));
  const mode = String(body.mode ?? "");
  const amount = parsePoints(body.amount);

  if (!gameId || !targetUserId || !amount) {
    return NextResponse.json({ error: "Game, player, and point amount are required." }, { status: 400 });
  }

  if (!["send", "request"].includes(mode)) {
    return NextResponse.json({ error: "Choose send or request." }, { status: 400 });
  }

  if (targetUserId.equals(user._id)) {
    return NextResponse.json({ error: "Choose another player." }, { status: 400 });
  }

  const { games, wallets, transactions } = await getCollections();
  const game = await games.findOne({ _id: gameId, status: { $ne: "ended" } });
  if (!game) {
    return NextResponse.json({ error: "Active game not found." }, { status: 404 });
  }

  const [currentWallet, targetWallet] = await Promise.all([
    wallets.findOne({ gameId, userId: user._id }),
    wallets.findOne({ gameId, userId: targetUserId })
  ]);

  const targetIsBank = Boolean(targetWallet && game.centralBankEnabled && isBankWallet(targetWallet));

  if (
    !currentWallet ||
    !targetWallet ||
    !isOccupiedWallet(currentWallet) ||
    (!isOccupiedWallet(targetWallet) && !targetIsBank)
  ) {
    return NextResponse.json({ error: "Choose a player or BANK in this game." }, { status: 400 });
  }

  if (mode === "send" && currentWallet.balance < amount) {
    return NextResponse.json({ error: "Insufficient points for this send." }, { status: 400 });
  }

  const fromUserId = mode === "send" ? user._id : targetUserId;
  const toUserId = mode === "send" ? targetUserId : user._id;

  await transactions.insertOne({
    _id: new ObjectId(),
    gameId,
    mode: mode as "send" | "request",
    initiatorId: user._id,
    counterpartyId: targetUserId,
    fromUserId,
    toUserId,
    amount,
    status: "pending",
    createdAt: new Date()
  });

  return NextResponse.json(await buildAppState(user));
}
