import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { requireUser } from "@/lib/auth";
import { ensureDatabase, getCollections, toObjectId, type UserDoc } from "@/lib/db";
import { formatPoints } from "@/lib/money";
import { isBankWallet, isOccupiedWallet, playerDisplayName } from "@/lib/seats";
import { serializeTransaction } from "@/lib/state";

function idOf(value: ObjectId): string {
  return value.toString();
}

function byId(users: UserDoc[]): Map<string, UserDoc> {
  return new Map(users.map((user) => [idOf(user._id), user]));
}

export async function GET(request: Request) {
  await ensureDatabase();
  const user = await requireUser();

  const { searchParams } = new URL(request.url);
  const selectedGameId = toObjectId(String(searchParams.get("gameId") || ""));
  const { games, wallets, transactions, users } = await getCollections();

  let gameRows =
    user.role === "admin"
      ? await games.find({}).sort({ createdAt: -1 }).toArray()
      : [];

  if (user.role === "user") {
    const userWalletRows = await wallets.find({ userId: user._id }).toArray();
    const userGameIds = userWalletRows.filter(isOccupiedWallet).map((wallet) => wallet.gameId);
    gameRows = userGameIds.length
      ? await games.find({ _id: { $in: userGameIds } }).sort({ createdAt: -1 }).toArray()
      : [];
    gameRows.sort((a, b) => {
      const statusOrder = Number(a.status === "ended") - Number(b.status === "ended");
      return statusOrder || b.createdAt.getTime() - a.createdAt.getTime();
    });
  }

  const gameIds = gameRows.map((game) => game._id);
  const walletRows = gameIds.length ? await wallets.find({ gameId: { $in: gameIds } }).toArray() : [];
  const occupiedCounts = new Map<string, number>();
  for (const wallet of walletRows.filter(isOccupiedWallet)) {
    const key = idOf(wallet.gameId);
    occupiedCounts.set(key, (occupiedCounts.get(key) || 0) + 1);
  }

  const gameList = gameRows.map((game) => ({
    id: idOf(game._id),
    name: game.name,
    status: game.status,
    centralBankEnabled: Boolean(game.centralBankEnabled),
    playerCount: occupiedCounts.get(idOf(game._id)) || 0,
    maxPlayers: game.maxPlayers,
    createdAt: game.createdAt.toISOString(),
    endedAt: game.endedAt?.toISOString() || null
  }));

  if (!selectedGameId) {
    return NextResponse.json({
      viewerRole: user.role,
      currentUserId: idOf(user._id),
      games: gameList,
      selectedGame: null
    });
  }

  const selectedGame = gameRows.find((game) => game._id.equals(selectedGameId));
  if (!selectedGame) {
    return NextResponse.json({ error: "Game not found." }, { status: 404 });
  }

  const [gameWallets, gameTransactions] = await Promise.all([
    wallets.find({ gameId: selectedGameId }).toArray(),
    transactions.find({ gameId: selectedGameId }).sort({ createdAt: -1 }).toArray()
  ]);

  const userIds = new Set<string>();
  for (const wallet of gameWallets) {
    userIds.add(idOf(wallet.userId));
  }
  for (const tx of gameTransactions) {
    userIds.add(idOf(tx.fromUserId));
    userIds.add(idOf(tx.toUserId));
    userIds.add(idOf(tx.initiatorId));
  }

  const userRows = userIds.size
    ? await users.find({ _id: { $in: [...userIds].map((id) => new ObjectId(id)) } }).toArray()
    : [];
  const userMap = byId(userRows);

  return NextResponse.json({
    viewerRole: user.role,
    currentUserId: idOf(user._id),
    games: gameList,
    selectedGame: {
      id: idOf(selectedGame._id),
      name: selectedGame.name,
      status: selectedGame.status,
      centralBankEnabled: Boolean(selectedGame.centralBankEnabled),
      playerCount: occupiedCounts.get(idOf(selectedGame._id)) || 0,
      maxPlayers: selectedGame.maxPlayers,
      initialFundsLabel: formatPoints(selectedGame.initialFunds),
      createdAt: selectedGame.createdAt.toISOString(),
      endedAt: selectedGame.endedAt?.toISOString() || null,
      players: gameWallets
        .filter((wallet) => !isBankWallet(wallet))
        .map((wallet) => {
          const player = userMap.get(idOf(wallet.userId));
          return {
            userId: idOf(wallet.userId),
            username: player ? playerDisplayName(player) : "Unknown",
            balance: wallet.balance,
            balanceLabel: formatPoints(wallet.balance),
            status: wallet.claimedAt ? "claimed" : "open",
            joinedAt: (wallet.claimedAt || wallet.joinedAt).toISOString()
          };
        })
        .sort((a, b) => b.balance - a.balance),
      transactions: gameTransactions.map((tx) => serializeTransaction(tx, userMap))
    }
  });
}
