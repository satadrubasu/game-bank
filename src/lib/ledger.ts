import type { ObjectId } from "mongodb";
import { getCollections } from "./db";

type TransferLike = {
  gameId: ObjectId;
  fromUserId: ObjectId;
  toUserId: ObjectId;
  amount: number;
};

export async function settleAcceptedTransfer(tx: TransferLike): Promise<{
  ok: boolean;
  note?: string;
}> {
  const { wallets } = await getCollections();
  const [fromWallet, toWallet] = await Promise.all([
    wallets.findOne({ gameId: tx.gameId, userId: tx.fromUserId }),
    wallets.findOne({ gameId: tx.gameId, userId: tx.toUserId })
  ]);

  if (!fromWallet || !toWallet) {
    return { ok: false, note: "Transfer wallet not found." };
  }

  if (!fromWallet.isBank) {
    const debit = await wallets.updateOne(
      {
        gameId: tx.gameId,
        userId: tx.fromUserId,
        balance: { $gte: tx.amount }
      },
      { $inc: { balance: -tx.amount } }
    );

    if (debit.modifiedCount !== 1) {
      return { ok: false, note: "Insufficient points at approval time." };
    }
  }

  if (!toWallet.isBank) {
    await wallets.updateOne(
      { gameId: tx.gameId, userId: tx.toUserId },
      { $inc: { balance: tx.amount } }
    );
  }

  return { ok: true };
}
