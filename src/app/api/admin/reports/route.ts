import { NextResponse } from "next/server";
import { ObjectId, type Filter } from "mongodb";
import { requireUser } from "@/lib/auth";
import { ensureDatabase, getCollections, type GameDoc } from "@/lib/db";
import { formatPoints } from "@/lib/money";
import { isOccupiedWallet, playerDisplayName } from "@/lib/seats";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parsePage(value: string | null): number {
  const page = Number(value || "1");
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function parsePageSize(value: string | null): number {
  const pageSize = Number(value || "6");
  if (!Number.isInteger(pageSize)) {
    return 6;
  }
  return Math.min(Math.max(pageSize, 4), 20);
}

function parseTimezoneOffset(value: string | null): number {
  const offset = Number(value || "0");
  return Number.isFinite(offset) ? offset : 0;
}

function startedOnFilter(
  value: string | null,
  timezoneOffsetMinutes: number
): Pick<Filter<GameDoc>, "createdAt"> {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return {};
  }

  const [year, month, day] = value.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day) + timezoneOffsetMinutes * 60_000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { createdAt: { $gte: start, $lt: end } };
}

export async function GET(request: Request) {
  await ensureDatabase();
  const user = await requireUser();
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Only admin can view reports." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = parsePage(searchParams.get("page"));
  const pageSize = parsePageSize(searchParams.get("pageSize"));
  const search = (searchParams.get("search") || "").trim();
  const startedOn = searchParams.get("startedOn");
  const scope = searchParams.get("scope") === "all" ? "all" : "ended";
  const timezoneOffset = parseTimezoneOffset(searchParams.get("timezoneOffset"));

  const filter: Filter<GameDoc> = {
    ...(scope === "ended" ? { status: "ended" as const } : {}),
    ...startedOnFilter(startedOn, timezoneOffset)
  };

  if (search) {
    filter.name = { $regex: escapeRegex(search), $options: "i" };
  }

  const { games, wallets, transactions, users } = await getCollections();
  const totalItems = await games.countDocuments(filter);
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);

  const pageGames = await games
    .find(filter)
    .sort({ createdAt: -1 })
    .skip((safePage - 1) * pageSize)
    .limit(pageSize)
    .toArray();

  const gameIds = pageGames.map((game) => game._id);
  const [walletRows, txRows] =
    gameIds.length === 0
      ? [[], []]
      : await Promise.all([
          wallets.find({ gameId: { $in: gameIds } }).toArray(),
          transactions
            .find({ gameId: { $in: gameIds }, status: { $in: ["accepted", "declined"] } })
            .toArray()
        ]);

  const userIds = [...new Set(walletRows.map((wallet) => wallet.userId.toString()))].map(
    (id) => new ObjectId(id)
  );
  const userRows = userIds.length ? await users.find({ _id: { $in: userIds } }).toArray() : [];
  const usernames = new Map(userRows.map((row) => [row._id.toString(), playerDisplayName(row)]));

  const walletsByGame = new Map<string, typeof walletRows>();
  for (const wallet of walletRows) {
    const gameId = wallet.gameId.toString();
    walletsByGame.set(gameId, [...(walletsByGame.get(gameId) || []), wallet]);
  }

  const transactionsByGame = new Map<string, typeof txRows>();
  for (const tx of txRows) {
    const gameId = tx.gameId.toString();
    transactionsByGame.set(gameId, [...(transactionsByGame.get(gameId) || []), tx]);
  }

  return NextResponse.json({
    items: pageGames.map((game) => {
      const gameWallets = (walletsByGame.get(game._id.toString()) || []).filter(isOccupiedWallet);
      const gameTransactions = transactionsByGame.get(game._id.toString()) || [];
      const accepted = gameTransactions.filter((tx) => tx.status === "accepted");
      const declined = gameTransactions.filter((tx) => tx.status === "declined");
      const acceptedVolume = accepted.reduce((sum, tx) => sum + tx.amount, 0);
      const leader = gameWallets
        .map((wallet) => ({
          username: usernames.get(wallet.userId.toString()) || "Unknown",
          balance: wallet.balance
        }))
        .sort((a, b) => b.balance - a.balance)[0];

      return {
        id: game._id.toString(),
        name: game.name,
        status: game.status,
        playerCount: gameWallets.length,
        maxPlayers: game.maxPlayers,
        acceptedCount: accepted.length,
        declinedCount: declined.length,
        acceptedVolumeLabel: formatPoints(acceptedVolume),
        leaderUsername: leader?.username || "-",
        leaderBalanceLabel: leader ? formatPoints(leader.balance) : "-",
        createdAt: game.createdAt.toISOString(),
        endedAt: game.endedAt?.toISOString() || null
      };
    }),
    pagination: {
      page: safePage,
      pageSize,
      totalItems,
      totalPages
    },
    filters: {
      search,
      startedOn: startedOn || "",
      scope
    }
  });
}
