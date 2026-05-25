import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { requireUser } from "@/lib/auth";
import { ensureDatabase, getCollections, toObjectId, type UserDoc } from "@/lib/db";
import { settleAcceptedTransfer } from "@/lib/ledger";
import { parsePoints, formatPoints } from "@/lib/money";
import { BANK_DISPLAY_NAME, isBankWallet, isOccupiedWallet, playerDisplayName, seatDisplayName } from "@/lib/seats";
import { serializeTransaction } from "@/lib/state";

function idOf(value: ObjectId): string {
  return value.toString();
}

function byId(users: UserDoc[]): Map<string, UserDoc> {
  return new Map(users.map((user) => [idOf(user._id), user]));
}

async function buildAdminBankState(gameId: ObjectId) {
  const { games, wallets, transactions, users } = await getCollections();
  const game = await games.findOne({ _id: gameId, status: { $ne: "ended" } });
  if (!game || !game.centralBankEnabled) {
    return null;
  }

  const gameWallets = await wallets.find({ gameId }).toArray();
  const bankWallet = gameWallets.find(isBankWallet);
  if (!bankWallet) {
    return null;
  }

  const playerWallets = gameWallets
    .filter(isOccupiedWallet)
    .sort((a, b) => (a.seatIndex ?? 999) - (b.seatIndex ?? 999));
  const seatWallets = gameWallets
    .filter((wallet) => Boolean(!isBankWallet(wallet) && wallet.seatColor))
    .sort((a, b) => (a.seatIndex ?? 999) - (b.seatIndex ?? 999));
  const gameTransactions = await transactions
    .find({ gameId })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();

  const userIds = new Set<string>([idOf(bankWallet.userId)]);
  for (const wallet of seatWallets) {
    userIds.add(idOf(wallet.userId));
  }
  for (const tx of gameTransactions) {
    userIds.add(idOf(tx.fromUserId));
    userIds.add(idOf(tx.toUserId));
    userIds.add(idOf(tx.initiatorId));
  }

  const userRows = await users
    .find({ _id: { $in: [...userIds].map((id) => new ObjectId(id)) } })
    .toArray();
  const userMap = byId(userRows);
  const bankUser = userMap.get(idOf(bankWallet.userId));

  return {
    game: {
      id: idOf(game._id),
      name: game.name,
      status: game.status,
      centralBankEnabled: true,
      bank: {
        userId: idOf(bankWallet.userId),
        username: bankUser ? seatDisplayName(bankUser) : BANK_DISPLAY_NAME
      }
    },
    players: playerWallets.map((wallet) => {
      const player = userMap.get(idOf(wallet.userId));
      return {
        userId: idOf(wallet.userId),
        username: player ? playerDisplayName(player) : "Unknown",
        color: wallet.seatColor || player?.seat?.color || "#167c80",
        icon: wallet.seatIcon || player?.seat?.icon || "P",
        balance: wallet.balance,
        balanceLabel: formatPoints(wallet.balance),
        joinedAt: (wallet.claimedAt || wallet.joinedAt).toISOString()
      };
    }),
    seatAssignments: seatWallets.map((wallet) => {
      const player = userMap.get(idOf(wallet.userId));
      const countryName = player ? seatDisplayName(player) : "Unknown";
      return {
        userId: idOf(wallet.userId),
        countryName,
        playerName: player?.playerName || "",
        username: player ? playerDisplayName(player) : countryName,
        reclaimCode: player?.reclaimCode || "",
        status: wallet.claimedAt ? "active" : player?.playerName ? "left" : "open"
      };
    }),
    pendingNotifications: gameTransactions
      .filter((tx) => tx.status === "pending" && tx.counterpartyId.equals(bankWallet.userId))
      .map((tx) => serializeTransaction(tx, userMap)),
    transactions: gameTransactions.map((tx) => serializeTransaction(tx, userMap))
  };
}

export async function GET(request: Request) {
  await ensureDatabase();
  const user = await requireUser();
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Only admin can operate the bank." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const gameId = toObjectId(String(searchParams.get("gameId") || ""));
  if (!gameId) {
    return NextResponse.json({ error: "Choose a bank-enabled game." }, { status: 400 });
  }

  const state = await buildAdminBankState(gameId);
  if (!state) {
    return NextResponse.json({ error: "Bank-enabled active game not found." }, { status: 404 });
  }

  return NextResponse.json(state);
}

export async function POST(request: Request) {
  await ensureDatabase();
  const user = await requireUser();
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Only admin can operate the bank." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const gameId = toObjectId(String(body.gameId ?? ""));
  const targetUserId = toObjectId(String(body.targetUserId ?? ""));
  const sourceUserId = toObjectId(String(body.sourceUserId ?? ""));
  const destinationUserId = toObjectId(String(body.destinationUserId ?? ""));
  const mode = String(body.mode ?? "");
  const amount = parsePoints(body.amount);

  if (!gameId || !amount || !["send", "collect", "move"].includes(mode)) {
    return NextResponse.json({ error: "Game, bank action, and point amount are required." }, { status: 400 });
  }

  if (mode !== "move" && !targetUserId) {
    return NextResponse.json({ error: "Choose an active player in this game." }, { status: 400 });
  }

  if (mode === "move" && (!sourceUserId || !destinationUserId)) {
    return NextResponse.json({ error: "Choose source and destination players." }, { status: 400 });
  }

  if (sourceUserId && destinationUserId && sourceUserId.equals(destinationUserId)) {
    return NextResponse.json({ error: "Choose two different players." }, { status: 400 });
  }

  const { games, wallets, transactions } = await getCollections();
  const game = await games.findOne({ _id: gameId, status: { $ne: "ended" }, centralBankEnabled: true });
  if (!game) {
    return NextResponse.json({ error: "Bank-enabled active game not found." }, { status: 404 });
  }

  const [bankWallet, targetWallet, sourceWallet, destinationWallet] = await Promise.all([
    wallets.findOne({ gameId, isBank: true }),
    targetUserId ? wallets.findOne({ gameId, userId: targetUserId }) : null,
    sourceUserId ? wallets.findOne({ gameId, userId: sourceUserId }) : null,
    destinationUserId ? wallets.findOne({ gameId, userId: destinationUserId }) : null
  ]);

  if (!bankWallet) {
    return NextResponse.json({ error: "Bank wallet not found." }, { status: 404 });
  }

  if (
    mode === "move" &&
    (!sourceWallet ||
      !destinationWallet ||
      !isOccupiedWallet(sourceWallet) ||
      !isOccupiedWallet(destinationWallet))
  ) {
    return NextResponse.json({ error: "Choose active players in this game." }, { status: 400 });
  }

  if (mode !== "move" && (!targetWallet || !isOccupiedWallet(targetWallet))) {
    return NextResponse.json({ error: "Choose an active player in this game." }, { status: 400 });
  }

  const now = new Date();
  const tx = {
    _id: new ObjectId(),
    gameId,
    mode: "send" as const,
    initiatorId: user._id,
    counterpartyId: mode === "move" ? destinationUserId! : targetUserId!,
    fromUserId:
      mode === "move" ? sourceUserId! : mode === "send" ? bankWallet.userId : targetUserId!,
    toUserId:
      mode === "move" ? destinationUserId! : mode === "send" ? targetUserId! : bankWallet.userId,
    amount,
    status: "processing" as const,
    createdAt: now,
    respondedAt: now,
    note: mode === "move" ? "Admin bank player transfer." : "Admin bank operation."
  };

  await transactions.insertOne(tx);
  const settled = await settleAcceptedTransfer(tx);

  await transactions.updateOne(
    { _id: tx._id },
    {
      $set: {
        status: settled.ok ? "accepted" : "declined",
        ...(settled.ok ? {} : { note: settled.note || "Unable to settle transfer." }),
        respondedAt: new Date()
      }
    }
  );

  if (!settled.ok) {
    return NextResponse.json({ error: settled.note || "Unable to settle transfer." }, { status: 400 });
  }

  return NextResponse.json(await buildAdminBankState(gameId));
}
