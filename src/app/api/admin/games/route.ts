import { NextResponse } from "next/server";
import type { Filter } from "mongodb";
import { requireUser } from "@/lib/auth";
import { ensureDatabase, getCollections, type GameDoc } from "@/lib/db";
import { formatPoints } from "@/lib/money";
import { isOccupiedWallet } from "@/lib/seats";

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
    return NextResponse.json({ error: "Only admin can view this list." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = parsePage(searchParams.get("page"));
  const pageSize = parsePageSize(searchParams.get("pageSize"));
  const search = (searchParams.get("search") || "").trim();
  const startedOn = searchParams.get("startedOn");
  const scope = searchParams.get("scope") === "all" ? "all" : "active";
  const timezoneOffset = parseTimezoneOffset(searchParams.get("timezoneOffset"));

  const filter: Filter<GameDoc> = {
    ...(scope === "active" ? { status: { $ne: "ended" as const } } : {}),
    ...startedOnFilter(startedOn, timezoneOffset)
  };

  if (search) {
    filter.name = { $regex: escapeRegex(search), $options: "i" };
  }

  const { games, wallets } = await getCollections();
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
  const pageWallets = gameIds.length ? await wallets.find({ gameId: { $in: gameIds } }).toArray() : [];
  const countsByGame = new Map<string, number>();
  for (const wallet of pageWallets.filter(isOccupiedWallet)) {
    const key = wallet.gameId.toString();
    countsByGame.set(key, (countsByGame.get(key) || 0) + 1);
  }

  return NextResponse.json({
    items: pageGames.map((game) => ({
      id: game._id.toString(),
      name: game.name,
      status: game.status,
      playerCount: countsByGame.get(game._id.toString()) || 0,
      maxPlayers: game.maxPlayers,
      initialFundsLabel: formatPoints(game.initialFunds),
      centralBankEnabled: Boolean(game.centralBankEnabled),
      createdAt: game.createdAt.toISOString(),
      endedAt: game.endedAt?.toISOString() || null
    })),
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
