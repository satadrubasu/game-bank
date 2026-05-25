"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  Check,
  Eye,
  EyeOff,
  House,
  Landmark,
  LayoutDashboard,
  RefreshCw,
  Search,
  Send,
  X
} from "lucide-react";

type AdminBankMode = "send" | "collect";
const TRANSACTION_PAGE_SIZE = 20;

type Player = {
  userId: string;
  username: string;
  color?: string;
  icon?: string;
  balance: number;
  balanceLabel: string;
  joinedAt: string;
};

type SeatAssignment = {
  userId: string;
  countryName: string;
  playerName: string;
  username: string;
  reclaimCode: string;
  status: "active" | "left" | "open";
};

type Transaction = {
  id: string;
  gameId: string;
  mode: "send" | "request";
  amountLabel: string;
  status: "pending" | "processing" | "accepted" | "declined";
  fromUserId: string;
  fromUsername: string;
  toUserId: string;
  toUsername: string;
  initiatorUsername: string;
  createdAt: string;
  respondedAt: string | null;
  note: string | null;
};

type AdminBankState = {
  game: {
    id: string;
    name: string;
    status: "open" | "frozen";
    bank: {
      userId: string;
      username: string;
    };
  };
  players: Player[];
  seatAssignments: SeatAssignment[];
  pendingNotifications: Transaction[];
  transactions: Transaction[];
};

function niceDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function niceTime(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

async function postJson(path: string, payload: Record<string, unknown> = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Something went wrong.");
  }
  return data;
}

export default function InGameClient({ gameId }: { gameId: string }) {
  const [bankState, setBankState] = useState<AdminBankState | null>(null);
  const [mode, setMode] = useState<AdminBankMode>("send");
  const [targetUserId, setTargetUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [sourceUserId, setSourceUserId] = useState("");
  const [destinationUserId, setDestinationUserId] = useState("");
  const [playerTransferAmount, setPlayerTransferAmount] = useState("");
  const [visibleOtpByUserId, setVisibleOtpByUserId] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadBankState = useCallback(async () => {
    if (!gameId) {
      setBankState(null);
      setError("Choose a game from Home to enter.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/bank?gameId=${encodeURIComponent(gameId)}`, {
        cache: "no-store"
      });
      const data = (await response.json().catch(() => ({}))) as AdminBankState & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Unable to load bank.");
      }
      setBankState(data);
      setVisibleOtpByUserId({});
    } catch (err) {
      setBankState(null);
      setError(err instanceof Error ? err.message : "Unable to load bank.");
    } finally {
      setBusy(false);
    }
  }, [gameId]);

  useEffect(() => {
    void loadBankState();
  }, [loadBankState]);

  useEffect(() => {
    if (sourceUserId && sourceUserId === destinationUserId) {
      setDestinationUserId("");
    }
  }, [destinationUserId, sourceUserId]);

  async function submitBankTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = (await postJson("/api/admin/bank", {
        gameId,
        targetUserId,
        mode,
        amount
      })) as AdminBankState;
      setBankState(data);
      setTargetUserId("");
      setAmount("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to operate bank.");
    } finally {
      setBusy(false);
    }
  }

  async function submitPlayerTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = (await postJson("/api/admin/bank", {
        gameId,
        mode: "move",
        sourceUserId,
        destinationUserId,
        amount: playerTransferAmount
      })) as AdminBankState;
      setBankState(data);
      setSourceUserId("");
      setDestinationUserId("");
      setPlayerTransferAmount("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to move player points.");
    } finally {
      setBusy(false);
    }
  }

  async function respondPendingTransaction(
    transactionId: string,
    decision: "accept" | "decline",
    failureMessage: string
  ) {
    setBusy(true);
    setError("");
    try {
      await postJson("/api/transactions/respond", { transactionId, decision });
      await loadBankState();
    } catch (err) {
      setError(err instanceof Error ? err.message : failureMessage);
    } finally {
      setBusy(false);
    }
  }

  async function respondBank(transactionId: string, decision: "accept" | "decline") {
    await respondPendingTransaction(transactionId, decision, "Unable to respond as bank.");
  }

  async function approvePendingTransaction(transactionId: string) {
    await respondPendingTransaction(transactionId, "accept", "Unable to approve transaction.");
  }

  async function denyPendingTransaction(transactionId: string) {
    await respondPendingTransaction(transactionId, "decline", "Unable to deny transaction.");
  }

  return (
    <main className="app-shell admin-shell">
      <header className="topbar">
        <div className="brand-row">
          <span className="brand-icon compact">
            <Landmark size={24} />
          </span>
          <div>
            <h1>{bankState?.game.name || "In Game"}</h1>
            <p>Banker controls</p>
          </div>
        </div>
        <div className="topbar-actions">
          <nav className="header-nav" aria-label="Main navigation">
            <Link className="nav-link" href="/">
              <House size={16} />
              Home
            </Link>
            <Link className="nav-link" href="/dashboard">
              <LayoutDashboard size={16} />
              Dashboard
            </Link>
          </nav>
          <button className="icon-button" title="Refresh bank" onClick={() => void loadBankState()}>
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      <section className="panel wide bank-console">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Central bank</p>
            <h2>{bankState?.game.name || "Bank operations"}</h2>
          </div>
          <Landmark size={22} />
        </div>

        {error && <p className="form-message">{error}</p>}
        {busy && !bankState && <EmptyState label="Loading bank" />}

        {!gameId && (
          <div className="empty">
            <Link className="ghost-button" href="/">
              <House size={16} />
              Choose a game
            </Link>
          </div>
        )}

        {bankState && (
          <>
            <div className="bank-grid ingame-bank-grid">
              <div className="bank-section bank-paper">
                <h3>Operate as BANK</h3>
                <form className="stack" onSubmit={submitBankTransfer}>
                  <div className="segmented small">
                    <button
                      className={mode === "send" ? "active" : ""}
                      type="button"
                      onClick={() => setMode("send")}
                    >
                      <Send size={15} />
                      Send
                    </button>
                    <button
                      className={mode === "collect" ? "active" : ""}
                      type="button"
                      onClick={() => setMode("collect")}
                    >
                      <Banknote size={15} />
                      Collect
                    </button>
                  </div>
                  <label>
                    Player
                    <select value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} required>
                      <option value="">Select player</option>
                      {bankState.players.map((player) => (
                        <option key={player.userId} value={player.userId}>
                          {player.username}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Amount
                    <input value={amount} onChange={(event) => setAmount(event.target.value)} />
                  </label>
                  <button className="primary-button" disabled={busy} type="submit">
                    <Landmark size={16} />
                    Apply
                  </button>
                </form>
              </div>

              <div className="bank-section bank-paper">
                <h3>Bank approvals</h3>
                <div className="notice-list">
                  {bankState.pendingNotifications.length === 0 && <EmptyState label="No bank approvals" />}
                  {bankState.pendingNotifications.map((tx) => (
                    <article className="notice" key={tx.id}>
                      <div>
                        <strong>{tx.amountLabel}</strong>
                        <p>
                          {tx.fromUsername} → {tx.toUsername}
                        </p>
                      </div>
                      <div className="row-actions">
                        <button
                          className="icon-button success"
                          disabled={busy}
                          title="Accept"
                          onClick={() => void respondBank(tx.id, "accept")}
                        >
                          <Check size={17} />
                        </button>
                        <button
                          className="icon-button danger"
                          disabled={busy}
                          title="Decline"
                          onClick={() => void respondBank(tx.id, "decline")}
                        >
                          <X size={17} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div className="bank-section bank-paper">
                <h3>Player transfer</h3>
                <form className="stack" onSubmit={submitPlayerTransfer}>
                  <label>
                    Source player
                    <select value={sourceUserId} onChange={(event) => setSourceUserId(event.target.value)} required>
                      <option value="">Select source</option>
                      {bankState.players.map((player) => (
                        <option key={player.userId} value={player.userId}>
                          {player.username}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Destination player
                    <select
                      value={destinationUserId}
                      onChange={(event) => setDestinationUserId(event.target.value)}
                      required
                    >
                      <option value="">Select destination</option>
                      {bankState.players
                        .filter((player) => player.userId !== sourceUserId)
                        .map((player) => (
                          <option key={player.userId} value={player.userId}>
                            {player.username}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Amount
                    <input
                      value={playerTransferAmount}
                      onChange={(event) => setPlayerTransferAmount(event.target.value)}
                    />
                  </label>
                  <button className="primary-button" disabled={busy} type="submit">
                    <ArrowLeftRight size={16} />
                    Move
                  </button>
                </form>
              </div>
            </div>

            <div className="ingame-seat-player-grid">
              <section className="bank-section bank-paper seat-otp-section">
                <h3>Seat OTPs</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Country</th>
                        <th>Player</th>
                        <th>Status</th>
                        <th>OTP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bankState.seatAssignments.length === 0 && (
                        <tr>
                          <td colSpan={4}>No seats found</td>
                        </tr>
                      )}
                      {bankState.seatAssignments.map((seat) => {
                        const showOtp = Boolean(visibleOtpByUserId[seat.userId]);
                        return (
                          <tr key={seat.userId}>
                            <td>{seat.countryName}</td>
                            <td>{seat.playerName || "-"}</td>
                            <td>
                              <span className={`status-badge ${seat.status === "active" ? "open" : seat.status}`}>
                                {seat.status}
                              </span>
                            </td>
                            <td>
                              {seat.reclaimCode ? (
                                <button
                                  className="ghost-button compact-button"
                                  type="button"
                                  onClick={() =>
                                    setVisibleOtpByUserId((current) => ({
                                      ...current,
                                      [seat.userId]: !current[seat.userId]
                                    }))
                                  }
                                >
                                  {showOtp ? <EyeOff size={16} /> : <Eye size={16} />}
                                  {showOtp ? seat.reclaimCode : "Show OTP"}
                                </button>
                              ) : (
                                "-"
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="bank-section bank-paper">
                <h3>Players</h3>
                <div className="table-wrap">
                  <table className="players-compact-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...bankState.players]
                        .sort((a, b) => b.balance - a.balance)
                        .map((player) => (
                          <tr key={player.userId}>
                            <td>{player.username}</td>
                            <td>{player.balanceLabel}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
            <TransactionsTable
              transactions={bankState.transactions}
              currentUserId={bankState.game.bank.userId}
              actionBusy={busy}
              onApprovePending={approvePendingTransaction}
              onDenyPending={denyPendingTransaction}
            />
          </>
        )}
      </section>
    </main>
  );
}

function TransactionsTable({
  transactions,
  currentUserId,
  actionBusy = false,
  onApprovePending,
  onDenyPending
}: {
  transactions: Transaction[];
  currentUserId: string;
  actionBusy?: boolean;
  onApprovePending?: (transactionId: string) => void | Promise<void>;
  onDenyPending?: (transactionId: string) => void | Promise<void>;
}) {
  const showActions = Boolean(onApprovePending || onDenyPending);
  const [transactionSearch, setTransactionSearch] = useState("");
  const [transactionPage, setTransactionPage] = useState(1);

  useEffect(() => {
    setTransactionPage(1);
  }, [transactionSearch, transactions]);

  const filteredTransactions = useMemo(() => {
    const needle = transactionSearch.trim().toLowerCase();
    if (!needle) {
      return transactions;
    }

    return transactions.filter((tx) =>
      [
        tx.fromUsername,
        tx.toUsername,
        tx.mode,
        tx.amountLabel,
        tx.status,
        niceTime(tx.createdAt)
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [transactionSearch, transactions]);

  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / TRANSACTION_PAGE_SIZE));
  const safePage = Math.min(transactionPage, totalPages);
  const pagedTransactions = filteredTransactions.slice(
    (safePage - 1) * TRANSACTION_PAGE_SIZE,
    safePage * TRANSACTION_PAGE_SIZE
  );

  return (
    <div className="ingame-transactions-section">
      <div className="section-title-row transaction-heading">
        <h3>Transactions</h3>
        <label className="table-search">
          Search
          <div className="search-field">
            <Search size={15} />
            <input
              type="search"
              value={transactionSearch}
              onChange={(event) => setTransactionSearch(event.target.value)}
              placeholder="Filter transactions"
            />
          </div>
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>Flow</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Time</th>
              {showActions && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {pagedTransactions.length === 0 && (
              <tr>
                <td colSpan={showActions ? 7 : 6}>No transactions found</td>
              </tr>
            )}
            {pagedTransactions.map((tx) => {
              const direction =
                tx.toUserId === currentUserId ? "in" : tx.fromUserId === currentUserId ? "out" : "other";
              const DirectionIcon =
                direction === "in" ? ArrowDownLeft : direction === "out" ? ArrowUpRight : ArrowLeftRight;
              const directionLabel = direction === "in" ? "In" : direction === "out" ? "Out" : "Other";
              const amountPrefix = direction === "in" ? "+" : direction === "out" ? "-" : "";

              return (
                <tr className={`transaction-row ${direction}`} key={tx.id}>
                  <td>{tx.fromUsername}</td>
                  <td>{tx.toUsername}</td>
                  <td>
                    <span className={`transaction-flow ${direction}`}>
                      <DirectionIcon size={15} />
                      {directionLabel}
                    </span>
                  </td>
                  <td>
                    <span className={`transaction-amount ${direction}`}>
                      {amountPrefix}
                      {tx.amountLabel}
                    </span>
                  </td>
                  <td>
                    <span className={`status-badge ${tx.status}`}>{tx.status}</span>
                  </td>
                  <td>{niceTime(tx.createdAt)}</td>
                  {showActions && (
                    <td>
                      {tx.status === "pending" ? (
                        <div className="row-actions">
                          {onApprovePending && (
                            <button
                              className="ghost-button compact-button"
                              disabled={actionBusy}
                              onClick={() => void onApprovePending(tx.id)}
                            >
                              <Check size={16} />
                              Approve
                            </button>
                          )}
                          {onDenyPending && (
                            <button
                              className="danger-button compact-button"
                              disabled={actionBusy}
                              onClick={() => void onDenyPending(tx.id)}
                            >
                              <X size={16} />
                              Deny
                            </button>
                          )}
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="pagination-bar">
        <span>
          Page {safePage} of {totalPages} - {filteredTransactions.length} transactions
        </span>
        <div className="row-actions">
          <button
            className="ghost-button"
            disabled={safePage <= 1}
            onClick={() => setTransactionPage((page) => Math.max(1, page - 1))}
          >
            Previous
          </button>
          <button
            className="ghost-button"
            disabled={safePage >= totalPages}
            onClick={() => setTransactionPage((page) => Math.min(totalPages, page + 1))}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="empty">{label}</div>;
}
