import { ObjectId } from "mongodb";
import {
  ensureDatabase,
  getCollections,
  type GameDoc,
  type TransactionDoc,
  type UserDoc,
  type WalletDoc
} from "./db";
import { formatPoints } from "./money";
import { serializeUser } from "./auth";
import { BANK_DISPLAY_NAME, isBankWallet, isOccupiedWallet, playerDisplayName, seatDisplayName } from "./seats";

type LeanSeat = {
  userId: string;
  username: string;
  color: string;
  icon: string;
  reserved: boolean;
};

type LeanGame = {
  id: string;
  name: string;
  status: GameDoc["status"];
  maxPlayers: number;
  initialFunds: number;
  initialFundsLabel: string;
  centralBankEnabled: boolean;
  playerCount: number;
  availableSeats: number;
  seats: LeanSeat[];
  joined: boolean;
  full: boolean;
  canJoin: boolean;
  createdAt: string;
  endedAt: string | null;
};

function idOf(value: ObjectId): string {
  return value.toString();
}

function byId<T extends { _id: ObjectId }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [idOf(item._id), item]));
}

function displayNameFor(user?: UserDoc): string {
  return user ? playerDisplayName(user) : "Unknown";
}

function groupByGame(wallets: WalletDoc[]): Map<string, WalletDoc[]> {
  const grouped = new Map<string, WalletDoc[]>();
  for (const wallet of wallets) {
    const gameId = idOf(wallet.gameId);
    grouped.set(gameId, [...(grouped.get(gameId) || []), wallet]);
  }
  return grouped;
}

function sortSeats(wallets: WalletDoc[]): WalletDoc[] {
  return [...wallets].sort((a, b) => (a.seatIndex ?? 999) - (b.seatIndex ?? 999));
}

function availableSeatWallets(wallets: WalletDoc[]): WalletDoc[] {
  return sortSeats(
    wallets.filter((wallet) => Boolean(!isBankWallet(wallet) && wallet.seatColor && !wallet.claimedAt))
  );
}

function serializeLeanGame(
  game: GameDoc,
  gameWallets: WalletDoc[],
  userMap: Map<string, UserDoc>,
  currentUser?: UserDoc,
  hasActiveWallet = false
): LeanGame {
  const occupiedWallets = gameWallets.filter(isOccupiedWallet);
  const availableWallets = availableSeatWallets(gameWallets);
  const hasSeatPlan = gameWallets.some((wallet) => Boolean(wallet.seatColor));
  const joined = currentUser
    ? occupiedWallets.some((wallet) => wallet.userId.equals(currentUser._id))
    : false;
  const full = hasSeatPlan ? availableWallets.length === 0 : occupiedWallets.length >= game.maxPlayers;

  return {
    id: idOf(game._id),
    name: game.name,
    status: game.status,
    maxPlayers: game.maxPlayers,
    initialFunds: game.initialFunds,
    initialFundsLabel: formatPoints(game.initialFunds),
    centralBankEnabled: Boolean(game.centralBankEnabled),
    playerCount: occupiedWallets.length,
    availableSeats: availableWallets.length,
    seats: availableWallets.map((wallet) => {
      const seatUser = userMap.get(idOf(wallet.userId));
      const seatName = seatUser ? seatDisplayName(seatUser) : "Unknown";
      return {
        userId: idOf(wallet.userId),
        username: seatName,
        color: wallet.seatColor || "#167c80",
        icon: wallet.seatIcon || seatName.slice(0, 1).toUpperCase(),
        reserved: Boolean(seatUser?.playerName && seatUser?.reclaimCode)
      };
    }),
    joined,
    full,
    canJoin: game.status === "open" && availableWallets.length > 0 && !joined && !hasActiveWallet,
    createdAt: game.createdAt.toISOString(),
    endedAt: game.endedAt?.toISOString() || null
  };
}

export function serializeTransaction(tx: TransactionDoc, users: Map<string, UserDoc>) {
  const from = users.get(idOf(tx.fromUserId));
  const to = users.get(idOf(tx.toUserId));
  const initiator = users.get(idOf(tx.initiatorId));

  return {
    id: idOf(tx._id),
    gameId: idOf(tx.gameId),
    mode: tx.mode,
    amount: tx.amount,
    amountLabel: formatPoints(tx.amount),
    status: tx.status,
    fromUserId: idOf(tx.fromUserId),
    fromUsername: displayNameFor(from),
    toUserId: idOf(tx.toUserId),
    toUsername: displayNameFor(to),
    initiatorUsername: displayNameFor(initiator),
    createdAt: tx.createdAt.toISOString(),
    respondedAt: tx.respondedAt?.toISOString() || null,
    note: tx.note || null
  };
}

export async function buildPublicState() {
  await ensureDatabase();
  const { users, games, wallets } = await getCollections();
  const [activeGames, allWallets] = await Promise.all([
    games.find({ status: { $ne: "ended" } }).sort({ createdAt: -1 }).toArray(),
    wallets.find({}).toArray()
  ]);

  const activeGameIds = new Set(activeGames.map((game) => idOf(game._id)));
  const activeWallets = allWallets.filter((wallet) => activeGameIds.has(idOf(wallet.gameId)));
  const userIds = [...new Set(activeWallets.map((wallet) => idOf(wallet.userId)))].map(
    (id) => new ObjectId(id)
  );
  const userDocs = userIds.length ? await users.find({ _id: { $in: userIds } }).toArray() : [];
  const userMap = byId(userDocs);
  const walletGroups = groupByGame(activeWallets);

  return {
    user: null,
    games: activeGames.map((game) =>
      serializeLeanGame(game, walletGroups.get(idOf(game._id)) || [], userMap)
    ),
    activeGame: null,
    endedReports: [],
    serverTime: new Date().toISOString()
  };
}

export async function buildAppState(user: UserDoc) {
  await ensureDatabase();
  const { users, games, wallets, transactions } = await getCollections();
  const [allGames, allWallets] = await Promise.all([
    games.find({}).sort({ createdAt: -1 }).toArray(),
    wallets.find({}).toArray()
  ]);

  const walletGroups = groupByGame(allWallets);
  const occupiedWallets = allWallets.filter(isOccupiedWallet);
  const userWallets = occupiedWallets.filter((wallet) => wallet.userId.equals(user._id));
  const activeGameIds = new Set(
    allGames.filter((game) => game.status !== "ended").map((game) => idOf(game._id))
  );
  const activeWallet = userWallets.find((wallet) => activeGameIds.has(idOf(wallet.gameId)));
  const activeGame = activeWallet
    ? allGames.find((game) => game._id.equals(activeWallet.gameId)) || null
    : null;

  const relatedGameIds = new Set<string>();
  if (activeGame) {
    relatedGameIds.add(idOf(activeGame._id));
  }

  for (const game of allGames) {
    if (
      game.status === "ended" &&
      (user.role === "admin" || userWallets.some((wallet) => wallet.gameId.equals(game._id)))
    ) {
      relatedGameIds.add(idOf(game._id));
    }
  }

  const relatedWallets = allWallets.filter((wallet) => relatedGameIds.has(idOf(wallet.gameId)));
  const relatedUserIds = new Set<string>([idOf(user._id)]);
  for (const wallet of relatedWallets) {
    relatedUserIds.add(idOf(wallet.userId));
  }
  for (const wallet of occupiedWallets) {
    relatedUserIds.add(idOf(wallet.userId));
  }
  for (const wallet of allWallets) {
    relatedUserIds.add(idOf(wallet.userId));
  }

  const userDocs = await users
    .find({ _id: { $in: [...relatedUserIds].map((id) => new ObjectId(id)) } })
    .toArray();
  const userMap = byId(userDocs);

  const leanGames: LeanGame[] = allGames.map((game) =>
    serializeLeanGame(
      game,
      walletGroups.get(idOf(game._id)) || [],
      userMap,
      user,
      Boolean(activeWallet)
    )
  );

  const activeTransactions = activeGame
    ? await transactions
        .find({ gameId: activeGame._id })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray()
    : [];

  const activeGameWallets = activeGame
    ? sortSeats((walletGroups.get(idOf(activeGame._id)) || []).filter(isOccupiedWallet))
    : [];
  const activeBankWallet = activeGame
    ? (walletGroups.get(idOf(activeGame._id)) || []).find(isBankWallet)
    : null;

  const activeGameDetail =
    activeGame && activeWallet
      ? {
          id: idOf(activeGame._id),
          name: activeGame.name,
          status: activeGame.status,
          centralBankEnabled: Boolean(activeGame.centralBankEnabled && activeBankWallet),
          bank: activeBankWallet
            ? {
                userId: idOf(activeBankWallet.userId),
                username: userMap.get(idOf(activeBankWallet.userId))
                  ? displayNameFor(userMap.get(idOf(activeBankWallet.userId)))
                  : BANK_DISPLAY_NAME
              }
            : null,
          wallet: {
            id: idOf(activeWallet._id),
            balance: activeWallet.balance,
            balanceLabel: formatPoints(activeWallet.balance),
            initialFundsLabel: formatPoints(activeWallet.initialFunds)
          },
          players: activeGameWallets.map((wallet) => ({
            userId: idOf(wallet.userId),
            username: displayNameFor(userMap.get(idOf(wallet.userId))),
            color: wallet.seatColor || userMap.get(idOf(wallet.userId))?.seat?.color || "#167c80",
            icon:
              wallet.seatIcon ||
              userMap.get(idOf(wallet.userId))?.seat?.icon ||
              displayNameFor(userMap.get(idOf(wallet.userId))).slice(0, 1).toUpperCase(),
            balance: wallet.balance,
            balanceLabel: formatPoints(wallet.balance),
            joinedAt: (wallet.claimedAt || wallet.joinedAt).toISOString()
          })),
          transactions: activeTransactions.map((tx) => serializeTransaction(tx, userMap)),
          pendingNotifications: activeTransactions
            .filter((tx) => tx.status === "pending" && tx.counterpartyId.equals(user._id))
            .map((tx) => serializeTransaction(tx, userMap))
        }
      : null;

  const endedReports = await Promise.all(
    allGames
      .filter(
        (game) =>
          game.status === "ended" &&
          (user.role === "admin" ||
            userWallets.some((wallet) => wallet.gameId.equals(game._id)))
      )
      .map(async (game) => {
        const gameWallets = sortSeats((walletGroups.get(idOf(game._id)) || []).filter(isOccupiedWallet));
        const txs = await transactions
          .find({ gameId: game._id, status: { $in: ["accepted", "declined"] } })
          .sort({ createdAt: -1 })
          .toArray();
        const accepted = txs.filter((tx) => tx.status === "accepted");
        const declined = txs.filter((tx) => tx.status === "declined");
        const acceptedVolume = accepted.reduce((sum, tx) => sum + tx.amount, 0);

        return {
          id: idOf(game._id),
          name: game.name,
          endedAt: game.endedAt?.toISOString() || null,
          initialFundsLabel: formatPoints(game.initialFunds),
          acceptedCount: accepted.length,
          declinedCount: declined.length,
          acceptedVolumeLabel: formatPoints(acceptedVolume),
          players: gameWallets
            .map((wallet) => ({
              userId: idOf(wallet.userId),
              username: displayNameFor(userMap.get(idOf(wallet.userId))),
              finalBalance: wallet.balance,
              finalBalanceLabel: formatPoints(wallet.balance),
              net: wallet.balance - wallet.initialFunds,
              netLabel: formatPoints(wallet.balance - wallet.initialFunds)
            }))
            .sort((a, b) => b.finalBalance - a.finalBalance),
          transactions: txs.map((tx) => serializeTransaction(tx, userMap))
        };
      })
  );

  return {
    user: serializeUser(user),
    games: leanGames,
    activeGame: activeGameDetail,
    endedReports,
    serverTime: new Date().toISOString()
  };
}
