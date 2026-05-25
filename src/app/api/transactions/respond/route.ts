import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { ensureDatabase, getCollections, toObjectId } from "@/lib/db";
import { settleAcceptedTransfer } from "@/lib/ledger";
import { buildAppState } from "@/lib/state";

export async function POST(request: Request) {
  await ensureDatabase();
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  const transactionId = toObjectId(String(body.transactionId ?? ""));
  const decision = String(body.decision ?? "");

  if (!transactionId || !["accept", "decline"].includes(decision)) {
    return NextResponse.json({ error: "Invalid transaction response." }, { status: 400 });
  }

  const { games, transactions } = await getCollections();
  const pending = await transactions.findOne({ _id: transactionId, status: "pending" });

  if (!pending) {
    return NextResponse.json({ error: "Pending transaction not found." }, { status: 404 });
  }

  if (user.role === "user" && !pending.counterpartyId.equals(user._id)) {
    return NextResponse.json({ error: "Pending transaction not found." }, { status: 404 });
  }

  if (user.role === "admin") {
    const game = await games.findOne({
      _id: pending.gameId,
      status: { $ne: "ended" },
      centralBankEnabled: true
    });

    if (!game) {
      return NextResponse.json({ error: "Pending bank-enabled transaction not found." }, { status: 404 });
    }
  }

  const claimed = await transactions.findOneAndUpdate(
    { _id: transactionId, status: "pending" },
    {
      $set: {
        status: "processing",
        respondedAt: new Date()
      }
    },
    { returnDocument: "after" }
  );

  if (!claimed) {
    return NextResponse.json({ error: "Pending transaction not found." }, { status: 404 });
  }

  if (decision === "decline") {
    await transactions.updateOne(
      { _id: transactionId },
      { $set: { status: "declined", respondedAt: new Date() } }
    );
    return NextResponse.json(await buildAppState(user));
  }

  const settled = await settleAcceptedTransfer(claimed);

  if (!settled.ok) {
    await transactions.updateOne(
      { _id: transactionId },
      {
        $set: {
          status: "declined",
          note: settled.note || "Unable to settle transfer.",
          respondedAt: new Date()
        }
      }
    );
    return NextResponse.json(await buildAppState(user));
  }

  await transactions.updateOne(
    { _id: transactionId },
    { $set: { status: "accepted", respondedAt: new Date() } }
  );

  return NextResponse.json(await buildAppState(user));
}
