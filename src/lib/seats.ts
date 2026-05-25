import { randomInt, randomUUID } from "crypto";
import { ObjectId } from "mongodb";
import type { UserDoc, WalletDoc } from "./db";

export const BANK_DISPLAY_NAME = "BANK";

const names = [
  "Russia",
  "China",
  "India",
  "USA",
  "Italy",
  "UK",
  "France",
  "Germany",
  "Switz",
  "Spain",
  "Saudi",
  "Brazil",
  "Canada"
];

const colors = [
  "#167c80",
  "#d76b1d",
  "#315f9f",
  "#2d8a54",
  "#c45d48",
  "#7a4fb3",
  "#b37808",
  "#1f7a5f",
  "#9d3d75",
  "#476f2d",
  "#2d6f9f",
  "#8a5634"
];

function shuffledSeatNames(count: number): string[] {
  const shuffled = [...names];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled.slice(0, count);
}

function seatIcon(displayName: string): string {
  return displayName.replace(/[^a-zA-Z0-9]/g, "").slice(0, 1).toUpperCase() || "P";
}

export function seatDisplayName(user: Pick<UserDoc, "displayName" | "username">): string {
  return user.displayName || user.username;
}

export function playerDisplayName(
  user: Pick<UserDoc, "displayName" | "playerName" | "username">
): string {
  const countryName = seatDisplayName(user);
  const playerName = user.playerName?.trim();
  return playerName ? `${countryName} (${playerName})` : countryName;
}

export function isOccupiedWallet(wallet: WalletDoc): boolean {
  return Boolean(!wallet.isBank && (wallet.claimedAt || !wallet.seatColor));
}

export function isBankWallet(wallet: WalletDoc): boolean {
  return Boolean(wallet.isBank);
}

export function buildGameSeats({
  gameId,
  maxPlayers,
  initialFunds,
  createdAt
}: {
  gameId: ObjectId;
  maxPlayers: number;
  initialFunds: number;
  createdAt: Date;
}): { users: UserDoc[]; wallets: WalletDoc[] } {
  const users: UserDoc[] = [];
  const wallets: WalletDoc[] = [];
  const gameSuffix = gameId.toString().slice(-6);
  const displayNames = shuffledSeatNames(maxPlayers);

  for (let index = 0; index < maxPlayers; index += 1) {
    const userId = new ObjectId();
    const displayName = displayNames[index];
    const color = colors[index % colors.length];
    const icon = seatIcon(displayName);

    users.push({
      _id: userId,
      username: `seat-${gameSuffix}-${index + 1}-${randomUUID().slice(0, 4)}`,
      displayName,
      password: randomUUID(),
      role: "user",
      seat: {
        gameId,
        color,
        icon,
        index
      },
      createdAt
    });

    wallets.push({
      _id: new ObjectId(),
      gameId,
      userId,
      balance: initialFunds,
      initialFunds,
      joinedAt: createdAt,
      seatColor: color,
      seatIcon: icon,
      seatIndex: index,
      createdAt
    });
  }

  return { users, wallets };
}

export function buildBankSeat({
  gameId,
  createdAt
}: {
  gameId: ObjectId;
  createdAt: Date;
}): { user: UserDoc; wallet: WalletDoc } {
  const userId = new ObjectId();
  const gameSuffix = gameId.toString().slice(-6);

  return {
    user: {
      _id: userId,
      username: `bank-${gameSuffix}-${randomUUID().slice(0, 4)}`,
      displayName: BANK_DISPLAY_NAME,
      password: randomUUID(),
      role: "user",
      createdAt
    },
    wallet: {
      _id: new ObjectId(),
      gameId,
      userId,
      balance: 0,
      initialFunds: 0,
      joinedAt: createdAt,
      isBank: true,
      createdAt
    }
  };
}
