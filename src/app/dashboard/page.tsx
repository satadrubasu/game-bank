"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  House,
  Landmark,
  LayoutDashboard,
  RefreshCw,
  Search,
  X
} from "lucide-react";

type GameStatus = "open" | "frozen" | "ended";
type TransactionStatus = "pending" | "processing" | "accepted" | "declined";

type DashboardGame = {
  id: string;
  name: string;
  status: GameStatus;
  centralBankEnabled: boolean;
  playerCount: number;
  maxPlayers: number;
  createdAt: string;
  endedAt: string | null;
};

type DashboardPlayer = {
  userId: string;
  username: string;
  balance: number;
  balanceLabel: string;
  status: "claimed" | "open";
  joinedAt: string;
};

type DashboardTransaction = {
  id: string;
  gameId: string;
  mode: "send" | "request";
  amountLabel: string;
  status: TransactionStatus;
  fromUserId: string;
  fromUsername: string;
  toUserId: string;
  toUsername: string;
  createdAt: string;
};

type DashboardDetail = DashboardGame & {
  initialFundsLabel: string;
  players: DashboardPlayer[];
  transactions: DashboardTransaction[];
};

type DashboardResponse = {
  viewerRole: "admin" | "user";
  currentUserId: string;
  games: DashboardGame[];
  selectedGame: DashboardDetail | null;
  error?: string;
};

const PAGE_SIZE = 20;

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

async function postJson(path: string, payload: Record<string, unknown> = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(data.error || "Something went wrong.");
  }
  return data;
}

async function fetchDashboard(gameId?: string): Promise<DashboardResponse> {
  const params = gameId ? `?gameId=${encodeURIComponent(gameId)}` : "";
  const response = await fetch(`/api/dashboard${params}`, { cache: "no-store" });
  const data = (await response.json().catch(() => ({}))) as DashboardResponse;
  if (!response.ok) {
    throw new Error(data.error || "Unable to load dashboard.");
  }
  return data;
}

function statusBadge(status: GameStatus | TransactionStatus) {
  return <span className={`status-badge ${status}`}>{status}</span>;
}

export default function DashboardPage() {
  const [games, setGames] = useState<DashboardGame[]>([]);
  const [selectedGameId, setSelectedGameId] = useState("");
  const [selectedGame, setSelectedGame] = useState<DashboardDetail | null>(null);
  const [gameSearch, setGameSearch] = useState("");
  const [openOnlyGames, setOpenOnlyGames] = useState(false);
  const [transactionSearch, setTransactionSearch] = useState("");
  const [transactionPage, setTransactionPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [actionBusyId, setActionBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [viewerRole, setViewerRole] = useState<"admin" | "user">("user");

  const loadGames = useCallback(async () => {
    setBusy(true);
    setMessage("");
    try {
      const data = await fetchDashboard();
      setViewerRole(data.viewerRole);
      setGames(data.games);
      if (!selectedGameId && data.games[0]) {
        setSelectedGameId(data.games[0].id);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load dashboard.");
    } finally {
      setBusy(false);
    }
  }, [selectedGameId]);

  const loadGameDetail = useCallback(async (gameId: string) => {
    setBusy(true);
    setMessage("");
    try {
      const data = await fetchDashboard(gameId);
      setViewerRole(data.viewerRole);
      setGames(data.games);
      setSelectedGame(data.selectedGame);
    } catch (error) {
      setSelectedGame(null);
      setMessage(error instanceof Error ? error.message : "Unable to load game.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadGames();
  }, [loadGames]);

  useEffect(() => {
    if (selectedGameId) {
      void loadGameDetail(selectedGameId);
    } else {
      setSelectedGame(null);
    }
  }, [loadGameDetail, selectedGameId]);

  useEffect(() => {
    setTransactionPage(1);
  }, [selectedGameId, transactionSearch]);

  const selectableGames = useMemo(
    () => games.filter((game) => !openOnlyGames || game.status === "open"),
    [games, openOnlyGames]
  );

  useEffect(() => {
    if (selectableGames.length === 0) {
      if (selectedGameId) {
        setSelectedGameId("");
      }
      setSelectedGame(null);
      return;
    }

    if (!selectedGameId || !selectableGames.some((game) => game.id === selectedGameId)) {
      setSelectedGameId(selectableGames[0].id);
    }
  }, [selectableGames, selectedGameId]);

  const visibleGames = useMemo(() => {
    const needle = gameSearch.trim().toLowerCase();
    const filtered = needle
      ? selectableGames.filter((game) =>
          [game.name, game.status, game.centralBankEnabled ? "bank" : ""].join(" ").toLowerCase().includes(needle)
        )
      : selectableGames;
    const selected = selectableGames.find((game) => game.id === selectedGameId);
    if (selected && !filtered.some((game) => game.id === selected.id)) {
      return [selected, ...filtered];
    }
    return filtered;
  }, [gameSearch, selectableGames, selectedGameId]);

  const filteredTransactions = useMemo(() => {
    const transactions = selectedGame?.transactions || [];
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
        niceDate(tx.createdAt)
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [selectedGame?.transactions, transactionSearch]);

  const totalTransactionPages = Math.max(1, Math.ceil(filteredTransactions.length / PAGE_SIZE));
  const safeTransactionPage = Math.min(transactionPage, totalTransactionPages);
  const pagedTransactions = filteredTransactions.slice(
    (safeTransactionPage - 1) * PAGE_SIZE,
    safeTransactionPage * PAGE_SIZE
  );

  async function respond(transactionId: string, decision: "accept" | "decline") {
    if (!selectedGameId || viewerRole !== "admin") {
      return;
    }

    setActionBusyId(transactionId);
    setMessage("");
    try {
      await postJson("/api/transactions/respond", { transactionId, decision });
      await loadGameDetail(selectedGameId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update transaction.");
    } finally {
      setActionBusyId("");
    }
  }

  return (
    <main className={`app-shell ${viewerRole === "admin" ? "admin-shell" : "player-shell"}`}>
      <header className="topbar">
        <div className="brand-row">
          <span className="brand-icon compact">
            <LayoutDashboard size={24} />
          </span>
          <div>
            <h1>Dashboard</h1>
            <p>{viewerRole === "admin" ? "Game state and transaction review" : "Your game state and transactions"}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <nav className="header-nav" aria-label="Main navigation">
            <Link className="nav-link" href="/">
              <House size={16} />
              Home
            </Link>
            <Link className="nav-link active" href="/dashboard">
              <LayoutDashboard size={16} />
              Dashboard
            </Link>
          </nav>
          <button
            className="icon-button"
            title="Refresh dashboard"
            onClick={() => selectedGameId ? void loadGameDetail(selectedGameId) : void loadGames()}
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      <section className="panel wide dashboard-control-panel">
        <div className="dashboard-toolbar">
          <div className="game-picker">
            <div className="game-picker-row">
              <span className="field-label">Game</span>
              <label className="mini-toggle">
                <input
                  checked={openOnlyGames}
                  type="checkbox"
                  onChange={(event) => setOpenOnlyGames(event.target.checked)}
                />
                <span>Open only</span>
              </label>
            </div>
            <div className="search-field">
              <Search size={15} />
              <input
                type="search"
                value={gameSearch}
                onChange={(event) => setGameSearch(event.target.value)}
                placeholder="Search games"
              />
            </div>
            <select
              aria-label="Game"
              value={selectedGameId}
              onChange={(event) => setSelectedGameId(event.target.value)}
            >
              <option value="">Choose a game</option>
              {visibleGames.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.name} - {game.status} - {game.playerCount}/{game.maxPlayers}
                </option>
              ))}
            </select>
          </div>
          <div className="dashboard-game-summary">
            {selectedGame ? (
              <>
                <strong>{selectedGame.name}</strong>
                <span>{selectedGame.playerCount}/{selectedGame.maxPlayers} players</span>
                <span>{selectedGame.initialFundsLabel} initial</span>
                {statusBadge(selectedGame.status)}
              </>
            ) : (
              <span>{busy ? "Loading games" : "Choose a game"}</span>
            )}
          </div>
        </div>
        {message && <p className="form-message">{message}</p>}
      </section>

      {selectedGame && (
        <>
          <section className="panel wide">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Section 1</p>
                <h2>Player balances</h2>
              </div>
              <Landmark size={22} />
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Balance</th>
                    <th>Seat</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedGame.players.length === 0 && (
                    <tr>
                      <td colSpan={4}>No players found</td>
                    </tr>
                  )}
                  {selectedGame.players.map((player) => (
                    <tr key={player.userId}>
                      <td>{player.username}</td>
                      <td>{player.balanceLabel}</td>
                      <td>{player.status}</td>
                      <td>{niceDate(player.joinedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel wide">
            <div className="panel-heading transaction-heading">
              <div>
                <p className="eyebrow">Section 2</p>
                <h2>Transactions</h2>
              </div>
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
                    {viewerRole === "admin" && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {pagedTransactions.length === 0 && (
                    <tr>
                      <td colSpan={viewerRole === "admin" ? 7 : 6}>No transactions found</td>
                    </tr>
                  )}
                  {pagedTransactions.map((tx) => {
                    const FlowIcon = tx.mode === "request" ? ArrowDownLeft : ArrowUpRight;
                    const canAct =
                      tx.status === "pending" &&
                      selectedGame.centralBankEnabled &&
                      selectedGame.status !== "ended";

                    return (
                      <tr key={tx.id}>
                        <td>{tx.fromUsername}</td>
                        <td>{tx.toUsername}</td>
                        <td>
                          <span className="transaction-flow other">
                            <FlowIcon size={15} />
                            {tx.mode}
                          </span>
                        </td>
                        <td>
                          <span className="transaction-amount other">{tx.amountLabel}</span>
                        </td>
                        <td>{statusBadge(tx.status)}</td>
                        <td>{niceDate(tx.createdAt)}</td>
                        {viewerRole === "admin" && (
                          <td>
                            {canAct ? (
                              <div className="row-actions">
                                <button
                                  className="ghost-button compact-button"
                                  disabled={actionBusyId === tx.id}
                                  onClick={() => void respond(tx.id, "accept")}
                                >
                                  <Check size={16} />
                                  Approve
                                </button>
                                <button
                                  className="danger-button compact-button"
                                  disabled={actionBusyId === tx.id}
                                  onClick={() => void respond(tx.id, "decline")}
                                >
                                  <X size={16} />
                                  Deny
                                </button>
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
                Page {safeTransactionPage} of {totalTransactionPages} - {filteredTransactions.length} transactions
              </span>
              <div className="row-actions">
                <button
                  className="ghost-button"
                  disabled={safeTransactionPage <= 1}
                  onClick={() => setTransactionPage((page) => Math.max(1, page - 1))}
                >
                  Previous
                </button>
                <button
                  className="ghost-button"
                  disabled={safeTransactionPage >= totalTransactionPages}
                  onClick={() => setTransactionPage((page) => Math.min(totalTransactionPages, page + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
