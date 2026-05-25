import { MongoClient, ObjectId, type Collection, type Db } from "mongodb";

export type UserRole = "admin" | "user";
export type GameStatus = "open" | "frozen" | "ended";
export type TransactionMode = "send" | "request";
export type TransactionStatus = "pending" | "processing" | "accepted" | "declined";

export type UserDoc = {
  _id: ObjectId;
  username: string;
  displayName?: string;
  playerName?: string;
  reclaimCode?: string;
  password: string;
  role: UserRole;
  seat?: {
    gameId: ObjectId;
    color: string;
    icon: string;
    index: number;
  };
  createdAt: Date;
};

export type SessionDoc = {
  _id: ObjectId;
  token: string;
  userId: ObjectId;
  createdAt: Date;
};

export type GameDoc = {
  _id: ObjectId;
  name: string;
  status: GameStatus;
  maxPlayers: number;
  initialFunds: number;
  centralBankEnabled?: boolean;
  bankUserId?: ObjectId;
  createdBy: ObjectId;
  createdAt: Date;
  endedAt?: Date;
};

export type WalletDoc = {
  _id: ObjectId;
  gameId: ObjectId;
  userId: ObjectId;
  balance: number;
  initialFunds: number;
  joinedAt: Date;
  claimedAt?: Date;
  seatColor?: string;
  seatIcon?: string;
  seatIndex?: number;
  isBank?: boolean;
  createdAt?: Date;
};

export type TransactionDoc = {
  _id: ObjectId;
  gameId: ObjectId;
  mode: TransactionMode;
  initiatorId: ObjectId;
  counterpartyId: ObjectId;
  fromUserId: ObjectId;
  toUserId: ObjectId;
  amount: number;
  status: TransactionStatus;
  createdAt: Date;
  respondedAt?: Date;
  note?: string;
};

type Collections = {
  users: Collection<UserDoc>;
  sessions: Collection<SessionDoc>;
  games: Collection<GameDoc>;
  wallets: Collection<WalletDoc>;
  transactions: Collection<TransactionDoc>;
};

declare global {
  // eslint-disable-next-line no-var
  var gameBankMongoClientPromise: Promise<MongoClient> | undefined;
}

const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/game_bank";
const dbName = process.env.MONGODB_DB || "game_bank";

let clientPromise = globalThis.gameBankMongoClientPromise;

function getClientPromise(): Promise<MongoClient> {
  if (!clientPromise) {
    clientPromise = new MongoClient(uri).connect().catch((error) => {
      clientPromise = undefined;
      globalThis.gameBankMongoClientPromise = undefined;
      throw error;
    });
  }

  if (process.env.NODE_ENV !== "production") {
    globalThis.gameBankMongoClientPromise = clientPromise;
  }

  return clientPromise;
}

let databaseReady = false;

export async function getDb(): Promise<Db> {
  const client = await getClientPromise();
  return client.db(dbName);
}

export async function getCollections(): Promise<Collections> {
  const db = await getDb();
  return {
    users: db.collection<UserDoc>("users"),
    sessions: db.collection<SessionDoc>("sessions"),
    games: db.collection<GameDoc>("games"),
    wallets: db.collection<WalletDoc>("wallets"),
    transactions: db.collection<TransactionDoc>("transactions")
  };
}

export async function ensureDatabase(): Promise<void> {
  if (databaseReady) {
    return;
  }

  const { users, sessions, games, wallets, transactions } = await getCollections();

  await Promise.all([
    users.createIndex({ username: 1 }, { unique: true }),
    users.createIndex({ "seat.gameId": 1 }),
    sessions.createIndex({ token: 1 }, { unique: true }),
    sessions.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 14 }),
    games.createIndex({ status: 1, createdAt: -1 }),
    games.createIndex({ name: 1, createdAt: -1 }),
    wallets.createIndex({ gameId: 1, userId: 1 }, { unique: true }),
    wallets.createIndex({ gameId: 1, claimedAt: 1 }),
    wallets.createIndex({ gameId: 1, isBank: 1 }),
    wallets.createIndex({ userId: 1 }),
    transactions.createIndex({ gameId: 1, createdAt: -1 }),
    transactions.createIndex({ counterpartyId: 1, status: 1 })
  ]);

  const adminUsername = process.env.ADMIN_USERNAME || "admin";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";

  await users.updateOne(
    { username: adminUsername },
    {
      $set: {
        username: adminUsername,
        password: adminPassword,
        role: "admin"
      },
      $setOnInsert: {
        _id: new ObjectId(),
        createdAt: new Date()
      }
    },
    { upsert: true }
  );

  databaseReady = true;
}

export function toObjectId(value: string): ObjectId | null {
  if (!ObjectId.isValid(value)) {
    return null;
  }

  return new ObjectId(value);
}
