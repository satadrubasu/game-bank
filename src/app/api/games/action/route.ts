import { NextResponse } from "next/server";
import { randomInt } from "crypto";
import { ObjectId } from "mongodb";
import {
  clearSessionCookie,
  createSession,
  getCurrentUser,
  requireUser,
  setSessionCookie
} from "@/lib/auth";
import { ensureDatabase, getCollections, toObjectId } from "@/lib/db";
import { isOccupiedWallet } from "@/lib/seats";
import { buildAppState, buildPublicState } from "@/lib/state";

const MAX_PLAYER_NAME_LENGTH = 30;
const RECLAIM_ERROR =
  "This seat was already claimed by a player who holds the OTP to reclaim this seat. It is unavailable to new users.";

function generateReclaimCode(): string {
  return String(randomInt(100, 1000));
}

function normalizePlayerName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeReclaimCode(value: unknown): string {
  return String(value ?? "").trim();
}

export async function POST(request: Request) {
  await ensureDatabase();
  const body = await request.json().catch(() => ({}));
  const gameId = toObjectId(String(body.gameId ?? ""));
  const action = String(body.action ?? "");

  if (!gameId) {
    return NextResponse.json({ error: "Invalid game id." }, { status: 400 });
  }

  const { users, games, wallets } = await getCollections();
  const game = await games.findOne({ _id: gameId });
  if (!game) {
    return NextResponse.json({ error: "Game not found." }, { status: 404 });
  }

  if (action === "claim") {
    const currentUser = await getCurrentUser();
    if (currentUser?.role === "admin") {
      return NextResponse.json({ error: "Admin manages games instead of taking seats." }, { status: 403 });
    }

    if (currentUser) {
      const activeGames = await games.find({ status: { $ne: "ended" } }).project({ _id: 1 }).toArray();
      const activeWallets = await wallets
        .find({ userId: currentUser._id, gameId: { $in: activeGames.map((activeGame) => activeGame._id) } })
        .toArray();
      if (activeWallets.some(isOccupiedWallet)) {
        return NextResponse.json(await buildAppState(currentUser));
      }
    }

    if (game.status !== "open") {
      return NextResponse.json({ error: "This game is not accepting players." }, { status: 400 });
    }

    const seatUserId = toObjectId(String(body.userId ?? body.seatUserId ?? ""));
    if (!seatUserId) {
      return NextResponse.json({ error: "Choose an available player seat." }, { status: 400 });
    }

    const seatUser = await users.findOne({ _id: seatUserId, role: "user" });
    if (!seatUser) {
      return NextResponse.json({ error: "Player seat not found." }, { status: 404 });
    }

    const existingReclaimCode = seatUser.reclaimCode?.trim();
    const isReservedSeat = Boolean(seatUser.playerName && existingReclaimCode);
    let playerName = normalizePlayerName(body.playerName);
    let newReclaimCode = "";

    if (isReservedSeat) {
      const reclaimCode = normalizeReclaimCode(body.reclaimCode ?? body.otp);
      if (reclaimCode !== existingReclaimCode) {
        return NextResponse.json({ error: RECLAIM_ERROR }, { status: 403 });
      }
      playerName = seatUser.playerName || "";
    } else {
      if (!playerName) {
        return NextResponse.json({ error: "Enter your name." }, { status: 400 });
      }
      if (playerName.length > MAX_PLAYER_NAME_LENGTH) {
        return NextResponse.json({ error: `Name must be ${MAX_PLAYER_NAME_LENGTH} characters or fewer.` }, { status: 400 });
      }
      newReclaimCode = generateReclaimCode();
    }

    const now = new Date();
    const claimedSeat = await wallets.findOneAndUpdate(
      {
        gameId,
        userId: seatUserId,
        seatColor: { $exists: true },
        claimedAt: { $exists: false }
      },
      { $set: { claimedAt: now, joinedAt: now } },
      { returnDocument: "after" }
    );

    if (!claimedSeat) {
      return NextResponse.json({ error: "That player seat is no longer available." }, { status: 409 });
    }

    let claimedUser = seatUser;
    if (!isReservedSeat) {
      await users.updateOne({ _id: seatUser._id }, { $set: { playerName, reclaimCode: newReclaimCode } });
      claimedUser = { ...seatUser, playerName, reclaimCode: newReclaimCode };
    }

    const token = await createSession(claimedUser._id);
    await setSessionCookie(token);
    const state = await buildAppState(claimedUser);
    return NextResponse.json(
      newReclaimCode
        ? { ...state, reclaimCode: newReclaimCode, reclaimCountry: seatUser.displayName || seatUser.username }
        : state
    );
  }

  const user = await requireUser();

  if (action === "leave") {
    if (user.role !== "user") {
      return NextResponse.json({ error: "Admin manages games instead of leaving seats." }, { status: 403 });
    }

    await wallets.updateOne(
      {
        gameId,
        userId: user._id,
        seatColor: { $exists: true },
        claimedAt: { $exists: true }
      },
      { $unset: { claimedAt: "" } }
    );
    await clearSessionCookie();

    const state = await buildPublicState();
    return NextResponse.json(
      user.reclaimCode
        ? { ...state, reclaimCode: user.reclaimCode, reclaimCountry: user.displayName || user.username }
        : state
    );
  }

  if (action === "join") {
    if (user.role !== "user") {
      return NextResponse.json({ error: "Admin manages games instead of joining them." }, { status: 403 });
    }

    if (game.status !== "open") {
      return NextResponse.json({ error: "This game is not accepting players." }, { status: 400 });
    }

    const activeGames = await games.find({ status: { $ne: "ended" } }).project({ _id: 1 }).toArray();
    const activeGameIds = activeGames.map((activeGame) => activeGame._id);
    const existingActiveWallets = await wallets.find({
      userId: user._id,
      gameId: { $in: activeGameIds }
    }).toArray();

    if (existingActiveWallets.some(isOccupiedWallet)) {
      return NextResponse.json({ error: "You are already in an active game." }, { status: 400 });
    }

    const gameWallets = await wallets.find({ gameId }).toArray();
    const playerCount = gameWallets.filter(isOccupiedWallet).length;
    if (playerCount >= game.maxPlayers) {
      return NextResponse.json({ error: "This game is already full." }, { status: 400 });
    }

    await wallets.insertOne({
      _id: new ObjectId(),
      gameId,
      userId: user._id,
      balance: game.initialFunds,
      initialFunds: game.initialFunds,
      joinedAt: new Date(),
      claimedAt: new Date()
    });

    return NextResponse.json(await buildAppState(user));
  }

  if (user.role !== "admin") {
    return NextResponse.json({ error: "Only admin can change game status." }, { status: 403 });
  }

  if (action === "freeze") {
    await games.updateOne({ _id: gameId, status: "open" }, { $set: { status: "frozen" } });
  } else if (action === "unfreeze") {
    await games.updateOne({ _id: gameId, status: "frozen" }, { $set: { status: "open" } });
  } else if (action === "end") {
    await games.updateOne(
      { _id: gameId, status: { $ne: "ended" } },
      { $set: { status: "ended", endedAt: new Date() } }
    );
  } else {
    return NextResponse.json({ error: "Unknown game action." }, { status: 400 });
  }

  return NextResponse.json(await buildAppState(user));
}
