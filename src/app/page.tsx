"use client";

import Link from "next/link";
import { Fragment, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  Check,
  ChevronDown,
  DoorOpen,
  Gavel,
  House,
  Landmark,
  LayoutDashboard,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Send,
  Shield,
  Users,
  X
} from "lucide-react";

type TransferMode = "send" | "request";
type User = {
  id: string;
  username: string;
  role: "admin" | "user";
};

type Game = {
  id: string;
  name: string;
  status: "open" | "frozen" | "ended";
  maxPlayers: number;
  initialFundsLabel: string;
  centralBankEnabled: boolean;
  playerCount: number;
  availableSeats: number;
  seats: Array<{
    userId: string;
    username: string;
    color: string;
    icon: string;
    reserved: boolean;
  }>;
  joined: boolean;
  full: boolean;
  canJoin: boolean;
  createdAt: string;
  endedAt: string | null;
};

type Player = {
  userId: string;
  username: string;
  color?: string;
  icon?: string;
  balance: number;
  balanceLabel: string;
  joinedAt: string;
};

type Transaction = {
  id: string;
  gameId: string;
  mode: TransferMode;
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

type ActiveGame = {
  id: string;
  name: string;
  status: "open" | "frozen";
  centralBankEnabled: boolean;
  bank: {
    userId: string;
    username: string;
  } | null;
  wallet: {
    balanceLabel: string;
    initialFundsLabel: string;
  };
  players: Player[];
  transactions: Transaction[];
  pendingNotifications: Transaction[];
};

type EndedReport = {
  id: string;
  name: string;
  endedAt: string | null;
  initialFundsLabel: string;
  acceptedCount: number;
  declinedCount: number;
  acceptedVolumeLabel: string;
  players: Array<{
    userId: string;
    username: string;
    finalBalanceLabel: string;
    netLabel: string;
  }>;
  transactions: Transaction[];
};

type AdminGameRow = {
  id: string;
  name: string;
  status: Game["status"];
  playerCount: number;
  maxPlayers: number;
  initialFundsLabel: string;
  centralBankEnabled: boolean;
  createdAt: string;
  endedAt: string | null;
};

type AdminGamesPage = {
  items: AdminGameRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};

type AdminReportRow = {
  id: string;
  name: string;
  status: Game["status"];
  playerCount: number;
  maxPlayers: number;
  acceptedCount: number;
  declinedCount: number;
  acceptedVolumeLabel: string;
  leaderUsername: string;
  leaderBalanceLabel: string;
  createdAt: string;
  endedAt: string | null;
};

type AdminReportsPage = {
  items: AdminReportRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};

type AppState = {
  user: User | null;
  games?: Game[];
  activeGame?: ActiveGame | null;
  endedReports?: EndedReport[];
  serverTime?: string;
};

type ReclaimNotice = {
  countryName: string;
  reclaimCode: string;
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

type ApiError = {
  error?: string;
};

function apiErrorMessage(data: ApiError | null, fallback: string): string {
  return typeof data?.error === "string" && data.error.trim() ? data.error : fallback;
}

export default function Home() {
  const [state, setState] = useState<AppState | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reclaimNotice, setReclaimNotice] = useState<ReclaimNotice | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/state", { cache: "no-store" });
    const data = (await response.json().catch(() => null)) as (AppState & ApiError) | null;
    if (!response.ok || !data) {
      setLoadError(apiErrorMessage(data, "Unable to load game state. Make sure MongoDB is running."));
      return;
    }

    setLoadError("");
    setState(data);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!state?.user) {
      return;
    }
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh, state?.user]);

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      await postJson("/api/auth/login", { username, password });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await postJson("/api/auth/logout");
    setPassword("");
    setMessage("");
    await refresh();
  }

  async function leaveGame() {
    try {
      setReclaimNotice(null);
      if (state?.activeGame) {
        const data = (await postJson("/api/games/action", {
          action: "leave",
          gameId: state.activeGame.id
        })) as AppState & { reclaimCode?: string; reclaimCountry?: string };
        if (data.reclaimCode) {
          setReclaimNotice({
            reclaimCode: data.reclaimCode,
            countryName: data.reclaimCountry || state.user?.username || "Seat"
          });
        }
      } else {
        await postJson("/api/auth/logout");
      }
    } catch {
      await postJson("/api/auth/logout").catch(() => undefined);
    }
    await refresh();
  }

  if (!state) {
    return (
      <main className="shell center-shell">
        <div className="loading-stack">
          <div className="loading-mark">
            <RefreshCw size={22} />
            Loading bank
          </div>
          {loadError && (
            <>
              <p className="form-message">{loadError}</p>
              <button className="primary-button" onClick={() => void refresh()}>
                <RefreshCw size={17} />
                Retry
              </button>
            </>
          )}
        </div>
      </main>
    );
  }

  if (!state.user) {
    return (
      <main className="auth-shell">
        <div className="auth-lobby-stack">
          {reclaimNotice && (
            <ReclaimOtpFlash notice={reclaimNotice} onDismiss={() => setReclaimNotice(null)} />
          )}
          <PublicLobby games={state.games || []} refresh={refresh} onClaimNotice={setReclaimNotice} />
        </div>

        <section className="auth-card" aria-label="Admin authentication">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Admin</p>
              <h2>Login</h2>
            </div>
            <Shield size={22} />
          </div>
          <form className="stack" onSubmit={handleAuth}>
            <label>
              Username
              <input
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {message && <p className="form-message">{message}</p>}
            <button className="primary-button" disabled={busy} type="submit">
              {busy ? <RefreshCw size={17} className="spin" /> : <LogIn size={17} />}
              Login
            </button>
          </form>
        </section>
      </main>
    );
  }

  const isAdmin = state.user.role === "admin";

  return (
    <main className={`app-shell ${isAdmin ? "admin-shell" : "player-shell"}`}>
      <header className="topbar">
        <div className="brand-row">
          <span className="brand-icon compact">
            <Landmark size={24} />
          </span>
          <div>
            {isAdmin ? (
              <>
                <h1>Game Bank</h1>
                <p>{state.user.username} · {state.user.role}</p>
              </>
            ) : (
              <>
                <p>Logged in as</p>
                <h1>{state.user.username}</h1>
              </>
            )}
          </div>
        </div>
        <div className="topbar-actions">
          <nav className="header-nav" aria-label="Main navigation">
            <Link className="nav-link active" href="/">
              <House size={16} />
              Home
            </Link>
            <Link className="nav-link" href="/dashboard">
              <LayoutDashboard size={16} />
              Dashboard
            </Link>
          </nav>
          {isAdmin && (
            <span className="admin-mode-pill">
              <Shield size={16} />
              Admin
            </span>
          )}
          {isAdmin && (
            <button className="icon-button" title="Refresh" onClick={() => void refresh()}>
              <RefreshCw size={18} />
            </button>
          )}
          {isAdmin && (
            <button className="ghost-button" onClick={() => void logout()}>
              <LogOut size={17} />
              Logout
            </button>
          )}
          {!isAdmin && (
            <button className="ghost-button" onClick={() => void leaveGame()}>
              <LogOut size={17} />
              Leave game
            </button>
          )}
        </div>
      </header>

      {isAdmin ? (
        <AdminDashboard state={state} refresh={refresh} />
      ) : (
        <PlayerDashboard
          state={state}
          refresh={refresh}
          reclaimNotice={reclaimNotice}
          onDismissReclaimNotice={() => setReclaimNotice(null)}
        />
      )}
    </main>
  );
}

function PublicLobby({
  games,
  refresh,
  onClaimNotice
}: {
  games: Game[];
  refresh: () => Promise<void>;
  onClaimNotice: (notice: ReclaimNotice) => void;
}) {
  const [selectedGameId, setSelectedGameId] = useState("");
  const [message, setMessage] = useState("");
  const [busySeatId, setBusySeatId] = useState("");
  const [gamesExpanded, setGamesExpanded] = useState(true);
  const [pendingSeat, setPendingSeat] = useState<{
    gameId: string;
    userId: string;
    countryName: string;
    reserved: boolean;
  } | null>(null);
  const [playerName, setPlayerName] = useState("");
  const [reclaimCode, setReclaimCode] = useState("");
  const [dialogError, setDialogError] = useState("");
  const activeGames = games.filter((game) => game.status !== "ended");
  const selectedGame = activeGames.find((game) => game.id === selectedGameId) || null;

  function openPlayerNameDialog(gameId: string, seat: Game["seats"][number]) {
    setPendingSeat({ gameId, userId: seat.userId, countryName: seat.username, reserved: seat.reserved });
    setPlayerName("");
    setReclaimCode("");
    setDialogError("");
    setMessage("");
  }

  function closePlayerNameDialog() {
    if (busySeatId) {
      return;
    }
    setPendingSeat(null);
    setPlayerName("");
    setReclaimCode("");
    setDialogError("");
  }

  async function claimSeat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingSeat) {
      return;
    }

    const trimmedName = playerName.trim().replace(/\s+/g, " ");
    const trimmedReclaimCode = reclaimCode.trim();
    if (pendingSeat.reserved) {
      if (!/^\d{3}$/.test(trimmedReclaimCode)) {
        setDialogError("Enter the 3-digit OTP.");
        return;
      }
    } else if (!trimmedName) {
      setDialogError("Enter your name.");
      return;
    }

    setBusySeatId(pendingSeat.userId);
    setMessage("");
    setDialogError("");
    try {
      const data = (await postJson("/api/games/action", {
        action: "claim",
        gameId: pendingSeat.gameId,
        userId: pendingSeat.userId,
        ...(pendingSeat.reserved ? { reclaimCode: trimmedReclaimCode } : { playerName: trimmedName })
      })) as AppState & { reclaimCode?: string; reclaimCountry?: string };
      if (data.reclaimCode) {
        onClaimNotice({
          reclaimCode: data.reclaimCode,
          countryName: data.reclaimCountry || pendingSeat.countryName
        });
      }
      setPendingSeat(null);
      setPlayerName("");
      setReclaimCode("");
      await refresh();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unable to claim seat.";
      setDialogError(errorMessage);
      setMessage(errorMessage);
      await refresh();
    } finally {
      setBusySeatId("");
    }
  }

  return (
    <section className="brand-panel lobby-panel">
      <div className="brand-lockup">
        <span className="brand-icon">
          <Landmark size={30} />
        </span>
        <div>
          <p className="eyebrow">Local game server</p>
          <h1>Game Bank</h1>
          <p className="brand-description">
            Pick an available player seat to enter a game and start moving points.
          </p>
        </div>
      </div>

      <div className="lobby-content">
        <div className="panel-heading accordion-heading">
          <button
            aria-controls="public-active-games-panel"
            aria-expanded={gamesExpanded}
            className="accordion-toggle"
            type="button"
            onClick={() => {
              setGamesExpanded((value) => !value);
              setSelectedGameId("");
            }}
          >
            <span>
              <h2>Active games</h2>
            </span>
            <span className="accordion-icons">
              <DoorOpen size={22} />
              <ChevronDown className={gamesExpanded ? "accordion-chevron open" : "accordion-chevron"} size={20} />
            </span>
          </button>
        </div>
        {gamesExpanded && (
          <div className="accordion-content" id="public-active-games-panel">
            {message && <p className="form-message">{message}</p>}
            <div className="lobby-game-list">
              {activeGames.length === 0 && <EmptyState label="No active games yet" />}
              {activeGames.map((game) => (
                <article className="lobby-game" key={game.id}>
                  <div className="lobby-game-row">
                    <div>
                      <h3>{game.name}</h3>
                      <p>
                        {game.availableSeats}/{game.maxPlayers} seats available · {game.initialFundsLabel} wallet
                      </p>
                    </div>
                    <button
                      className="primary-button compact-button"
                      disabled={!game.canJoin}
                      onClick={() => setSelectedGameId((current) => (current === game.id ? "" : game.id))}
                    >
                      <DoorOpen size={16} />
                      {selectedGameId === game.id
                        ? "Hide seats"
                        : game.status === "frozen"
                          ? "Frozen"
                          : game.availableSeats <= 0
                            ? "Full"
                            : "Choose seat"}
                    </button>
                  </div>
                  {selectedGame?.id === game.id && (
                    <div className="seat-picker" aria-label={`Available seats for ${game.name}`}>
                      {game.seats.length === 0 && <EmptyState label="No seats available" />}
                      {game.seats.map((seat) => (
                        <button
                          className="seat-button"
                          disabled={Boolean(busySeatId)}
                          key={seat.userId}
                          type="button"
                          onClick={() => openPlayerNameDialog(game.id, seat)}
                        >
                          <span className="seat-token" style={{ backgroundColor: seat.color }}>
                            {seat.icon}
                          </span>
                          {seat.username}
                          {seat.reserved && <span className="seat-reclaim-tag">OTP</span>}
                          {busySeatId === seat.userId && <RefreshCw size={15} className="spin" />}
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
      {pendingSeat && (
        <div className="modal-backdrop">
          <form
            aria-labelledby="player-name-title"
            aria-modal="true"
            className="player-name-dialog"
            role="dialog"
            onSubmit={claimSeat}
          >
            <div className="dialog-title-row">
              <div>
                <p className="eyebrow">Country</p>
                <h2 id="player-name-title">{pendingSeat.reserved ? "Enter reclaim OTP" : "Enter your name"}</h2>
              </div>
              <span className="country-pill">{pendingSeat.countryName}</span>
            </div>
            <label>
              {pendingSeat.reserved ? "OTP" : "Player name"}
              {pendingSeat.reserved ? (
                <input
                  autoFocus
                  inputMode="numeric"
                  maxLength={3}
                  pattern="[0-9]*"
                  value={reclaimCode}
                  onChange={(event) => {
                    setReclaimCode(event.target.value.replace(/\D/g, "").slice(0, 3));
                    setDialogError("");
                  }}
                />
              ) : (
                <input
                  autoFocus
                  maxLength={30}
                  value={playerName}
                  onChange={(event) => {
                    setPlayerName(event.target.value);
                    setDialogError("");
                  }}
                />
              )}
            </label>
            {dialogError && <p className="form-message">{dialogError}</p>}
            <div className="dialog-actions">
              <button className="ghost-button" disabled={Boolean(busySeatId)} type="button" onClick={closePlayerNameDialog}>
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={Boolean(busySeatId) || (pendingSeat.reserved ? reclaimCode.length !== 3 : !playerName.trim())}
                type="submit"
              >
                {busySeatId === pendingSeat.userId && <RefreshCw size={15} className="spin" />}
                OK
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function ReclaimOtpFlash({
  notice,
  onDismiss
}: {
  notice: ReclaimNotice;
  onDismiss: () => void;
}) {
  return (
    <section className="otp-flash panel wide">
      <div>
        <p className="eyebrow">Reclaim OTP</p>
        <h2>{notice.countryName}</h2>
      </div>
      <strong>{notice.reclaimCode}</strong>
      <span>Use this code to rejoin this country after leaving.</span>
      <button className="icon-button" title="Dismiss OTP" onClick={onDismiss}>
        <X size={16} />
      </button>
    </section>
  );
}

function AdminDashboard({ state, refresh }: { state: AppState; refresh: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState("5");
  const [initialFunds, setInitialFunds] = useState("1500");
  const [centralBankEnabled, setCentralBankEnabled] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [gameSearch, setGameSearch] = useState("");
  const [startedOn, setStartedOn] = useState("");
  const [gameScope, setGameScope] = useState<"active" | "all">("active");
  const [gamePage, setGamePage] = useState(1);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState("");
  const [reportReloadKey, setReportReloadKey] = useState(0);
  const [createExpanded, setCreateExpanded] = useState(false);
  const [gamesExpanded, setGamesExpanded] = useState(false);
  const [adminGames, setAdminGames] = useState<AdminGamesPage>({
    items: [],
    pagination: {
      page: 1,
      pageSize: 6,
      totalItems: 0,
      totalPages: 1
    }
  });

  const loadAdminGames = useCallback(
    async (pageOverride?: number) => {
      const requestedPage = pageOverride || gamePage;
      const params = new URLSearchParams({
        page: String(requestedPage),
        pageSize: "6",
        search: gameSearch,
        startedOn,
        scope: gameScope,
        timezoneOffset: String(new Date().getTimezoneOffset())
      });

      setListBusy(true);
      setListError("");
      try {
        const response = await fetch(`/api/admin/games?${params.toString()}`, { cache: "no-store" });
        const data = (await response.json().catch(() => ({}))) as AdminGamesPage & { error?: string };
        if (!response.ok) {
          throw new Error(data.error || "Unable to load games.");
        }
        setAdminGames(data);
        setGamePage(data.pagination.page);
      } catch (err) {
        setListError(err instanceof Error ? err.message : "Unable to load games.");
      } finally {
        setListBusy(false);
      }
    },
    [gamePage, gameScope, gameSearch, startedOn]
  );

  useEffect(() => {
    if (gamesExpanded) {
      void loadAdminGames();
    }
  }, [gamesExpanded, loadAdminGames]);

  async function createGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await postJson("/api/games", { name, maxPlayers, initialFunds, centralBankEnabled });
      setName("");
      setCentralBankEnabled(false);
      setGamePage(1);
      setReportReloadKey((value) => value + 1);
      if (gamesExpanded) {
        await loadAdminGames(1);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create game.");
    } finally {
      setBusy(false);
    }
  }

  async function act(gameId: string, action: "freeze" | "unfreeze" | "end") {
    setError("");
    try {
      await postJson("/api/games/action", { gameId, action });
      setReportReloadKey((value) => value + 1);
      if (gamesExpanded) {
        await loadAdminGames();
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update game.");
    }
  }

  function updateSearch(value: string) {
    setGameSearch(value);
    setGamePage(1);
  }

  function updateStartedOn(value: string) {
    setStartedOn(value);
    setGamePage(1);
  }

  function updateScope(value: "active" | "all") {
    setGameScope(value);
    setGamePage(1);
  }

  return (
    <div className="dashboard-grid">
      <section className="panel accordion-panel">
        <div className="panel-heading accordion-heading">
          <button
            aria-controls="admin-create-game-panel"
            aria-expanded={createExpanded}
            className="accordion-toggle"
            type="button"
            onClick={() => setCreateExpanded((value) => !value)}
          >
            <span>
              <h2>Create game</h2>
            </span>
            <span className="accordion-icons">
              <Gavel size={22} />
              <ChevronDown className={createExpanded ? "accordion-chevron open" : "accordion-chevron"} size={20} />
            </span>
          </button>
        </div>
        {createExpanded && (
          <div className="accordion-content" id="admin-create-game-panel">
            <form className="form-grid" onSubmit={createGame}>
              <label>
                Game Name
                <input
                  maxLength={12}
                  value={name}
                  onChange={(event) => setName(event.target.value.slice(0, 12))}
                  placeholder=""
                />
              </label>
              <label>
                Player seats
                <input
                  min={2}
                  max={12}
                  type="number"
                  value={maxPlayers}
                  onChange={(event) => setMaxPlayers(event.target.value)}
                />
              </label>
              <label>
                Initial points
                <input value={initialFunds} onChange={(event) => setInitialFunds(event.target.value)} />
              </label>
              <label className="check-option span-all">
                <input
                  checked={centralBankEnabled}
                  type="checkbox"
                  onChange={(event) => setCentralBankEnabled(event.target.checked)}
                />
                <span>Enable central bank</span>
              </label>
              {error && <p className="form-message span-all">{error}</p>}
              <button className="primary-button span-all" disabled={busy} type="submit">
                <Plus size={17} />
                Create game
              </button>
            </form>
          </div>
        )}
      </section>

      <section className="panel wide accordion-panel">
        <div className="panel-heading accordion-heading">
          <button
            aria-controls="admin-games-panel"
            aria-expanded={gamesExpanded}
            className="accordion-toggle"
            type="button"
            onClick={() => setGamesExpanded((value) => !value)}
          >
            <span>
              <h2>Game List</h2>
            </span>
            <span className="accordion-icons">
              <Users size={22} />
              <ChevronDown className={gamesExpanded ? "accordion-chevron open" : "accordion-chevron"} size={20} />
            </span>
          </button>
        </div>
        {gamesExpanded && (
          <div className="accordion-content" id="admin-games-panel">
            <div className="admin-game-tools">
              <label>
                Search
                <input
                  value={gameSearch}
                  onChange={(event) => updateSearch(event.target.value)}
                  placeholder="Game name"
                />
              </label>
              <label>
                Started
                <input type="date" value={startedOn} onChange={(event) => updateStartedOn(event.target.value)} />
              </label>
              <fieldset className="radio-toggle">
                <legend>Status</legend>
                <label>
                  <input
                    checked={gameScope === "active"}
                    name="admin-game-scope"
                    type="radio"
                    onChange={() => updateScope("active")}
                  />
                  Active only
                </label>
                <label>
                  <input
                    checked={gameScope === "all"}
                    name="admin-game-scope"
                    type="radio"
                    onChange={() => updateScope("all")}
                  />
                  Include ended
                </label>
              </fieldset>
            </div>
            {listError && <p className="form-message">{listError}</p>}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Game</th>
                    <th>Status</th>
                    <th>Players</th>
                    <th>Initial</th>
                    <th>Started</th>
                    <th>Ended</th>
                  </tr>
                </thead>
                <tbody>
                  {adminGames.items.length === 0 && (
                    <tr>
                      <td colSpan={6}>{listBusy ? "Loading games" : "No games found"}</td>
                    </tr>
                  )}
                  {adminGames.items.map((game) => (
                    <Fragment key={game.id}>
                      <tr>
                        <td>{game.name}</td>
                        <td>
                          <StatusBadge status={game.status} />
                        </td>
                        <td>
                          {game.playerCount}/{game.maxPlayers}
                        </td>
                        <td>{game.initialFundsLabel}</td>
                        <td>{niceDate(game.createdAt)}</td>
                        <td>{niceDate(game.endedAt)}</td>
                      </tr>
                      <tr className="hosted-actions-row">
                        <td colSpan={6}>
                          <div className="row-actions hosted-row-actions">
                            {game.status === "open" && (
                              <button className="ghost-button" onClick={() => void act(game.id, "freeze")}>
                                Freeze
                              </button>
                            )}
                            {game.status === "frozen" && (
                              <button className="ghost-button" onClick={() => void act(game.id, "unfreeze")}>
                                Unfreeze
                              </button>
                            )}
                            {game.status !== "ended" && (
                              <button className="danger-button" onClick={() => void act(game.id, "end")}>
                                End
                              </button>
                            )}
                            {game.centralBankEnabled && game.status !== "ended" && (
                              <Link className="ghost-button" href={`/ingame?gameId=${encodeURIComponent(game.id)}`}>
                                Enter
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination-bar">
              <span>
                Page {adminGames.pagination.page} of {adminGames.pagination.totalPages} ·{" "}
                {adminGames.pagination.totalItems} games
              </span>
              <div className="row-actions">
                <button
                  className="ghost-button"
                  disabled={listBusy || adminGames.pagination.page <= 1}
                  onClick={() => setGamePage((page) => Math.max(1, page - 1))}
                >
                  Previous
                </button>
                <button
                  className="ghost-button"
                  disabled={listBusy || adminGames.pagination.page >= adminGames.pagination.totalPages}
                  onClick={() =>
                    setGamePage((page) => Math.min(adminGames.pagination.totalPages, page + 1))
                  }
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <AdminReportsTable reloadKey={reportReloadKey} />
    </div>
  );
}

function AdminReportsTable({ reloadKey }: { reloadKey: number }) {
  const [reportSearch, setReportSearch] = useState("");
  const [reportStartedOn, setReportStartedOn] = useState("");
  const [reportScope, setReportScope] = useState<"ended" | "all">("ended");
  const [reportPage, setReportPage] = useState(1);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportsExpanded, setReportsExpanded] = useState(false);
  const [adminReports, setAdminReports] = useState<AdminReportsPage>({
    items: [],
    pagination: {
      page: 1,
      pageSize: 6,
      totalItems: 0,
      totalPages: 1
    }
  });

  const loadAdminReports = useCallback(
    async (pageOverride?: number) => {
      const requestedPage = pageOverride || reportPage;
      const params = new URLSearchParams({
        page: String(requestedPage),
        pageSize: "6",
        search: reportSearch,
        startedOn: reportStartedOn,
        scope: reportScope,
        timezoneOffset: String(new Date().getTimezoneOffset())
      });

      setReportBusy(true);
      setReportError("");
      try {
        const response = await fetch(`/api/admin/reports?${params.toString()}`, {
          cache: "no-store"
        });
        const data = (await response.json().catch(() => ({}))) as AdminReportsPage & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(data.error || "Unable to load reports.");
        }
        setAdminReports(data);
        setReportPage(data.pagination.page);
      } catch (err) {
        setReportError(err instanceof Error ? err.message : "Unable to load reports.");
      } finally {
        setReportBusy(false);
      }
    },
    [reportPage, reportScope, reportSearch, reportStartedOn]
  );

  useEffect(() => {
    if (reportsExpanded) {
      void loadAdminReports();
    }
  }, [loadAdminReports, reloadKey, reportsExpanded]);

  function updateReportSearch(value: string) {
    setReportSearch(value);
    setReportPage(1);
  }

  function updateReportStartedOn(value: string) {
    setReportStartedOn(value);
    setReportPage(1);
  }

  function updateReportScope(value: "ended" | "all") {
    setReportScope(value);
    setReportPage(1);
  }

  return (
    <section className="panel wide accordion-panel">
      <div className="panel-heading accordion-heading">
        <button
          aria-controls="admin-reports-panel"
          aria-expanded={reportsExpanded}
          className="accordion-toggle"
          type="button"
          onClick={() => setReportsExpanded((value) => !value)}
        >
          <span>
            <h2>Reports</h2>
          </span>
          <span className="accordion-icons">
            <Landmark size={22} />
            <ChevronDown className={reportsExpanded ? "accordion-chevron open" : "accordion-chevron"} size={20} />
          </span>
        </button>
      </div>
      {reportsExpanded && (
        <div className="accordion-content" id="admin-reports-panel">
          <div className="admin-game-tools">
            <label>
              Search
              <input
                value={reportSearch}
                onChange={(event) => updateReportSearch(event.target.value)}
                placeholder="Game name"
              />
            </label>
            <label>
              Started
              <input
                type="date"
                value={reportStartedOn}
                onChange={(event) => updateReportStartedOn(event.target.value)}
              />
            </label>
            <fieldset className="radio-toggle">
              <legend>Status</legend>
              <label>
                <input
                  checked={reportScope === "ended"}
                  name="admin-report-scope"
                  type="radio"
                  onChange={() => updateReportScope("ended")}
                />
                Ended only
              </label>
              <label>
                <input
                  checked={reportScope === "all"}
                  name="admin-report-scope"
                  type="radio"
                  onChange={() => updateReportScope("all")}
                />
                Include active
              </label>
            </fieldset>
          </div>
          {reportError && <p className="form-message">{reportError}</p>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Game</th>
                  <th>Status</th>
                  <th>Volume</th>
                  <th>Leader</th>
                  <th>Started</th>
                  <th>Ended</th>
                </tr>
              </thead>
              <tbody>
                {adminReports.items.length === 0 && (
                  <tr>
                    <td colSpan={6}>{reportBusy ? "Loading reports" : "No reports found"}</td>
                  </tr>
                )}
                {adminReports.items.map((report) => (
                  <tr key={report.id}>
                    <td>{report.name}</td>
                    <td>
                      <StatusBadge status={report.status} />
                    </td>
                    <td>{report.acceptedVolumeLabel}</td>
                    <td>
                      {report.leaderUsername}
                      {report.leaderBalanceLabel !== "-" ? ` · ${report.leaderBalanceLabel}` : ""}
                    </td>
                    <td>{niceDate(report.createdAt)}</td>
                    <td>{niceDate(report.endedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination-bar">
            <span>
              Page {adminReports.pagination.page} of {adminReports.pagination.totalPages} ·{" "}
              {adminReports.pagination.totalItems} reports
            </span>
            <div className="row-actions">
              <button
                className="ghost-button"
                disabled={reportBusy || adminReports.pagination.page <= 1}
                onClick={() => setReportPage((page) => Math.max(1, page - 1))}
              >
                Previous
              </button>
              <button
                className="ghost-button"
                disabled={reportBusy || adminReports.pagination.page >= adminReports.pagination.totalPages}
                onClick={() =>
                  setReportPage((page) => Math.min(adminReports.pagination.totalPages, page + 1))
                }
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function PlayerDashboard({
  state,
  refresh,
  reclaimNotice,
  onDismissReclaimNotice
}: {
  state: AppState;
  refresh: () => Promise<void>;
  reclaimNotice: ReclaimNotice | null;
  onDismissReclaimNotice: () => void;
}) {
  return (
    <div className="dashboard-grid">
      {reclaimNotice && <ReclaimOtpFlash notice={reclaimNotice} onDismiss={onDismissReclaimNotice} />}
      {state.activeGame ? (
        <BankingPanel activeGame={state.activeGame} currentUserId={state.user?.id || ""} refresh={refresh} />
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Wallet</p>
              <h2>No active game</h2>
            </div>
            <Banknote size={22} />
          </div>
          <EmptyState label="Join an open game to receive points" />
        </section>
      )}
    </div>
  );
}

function BankingPanel({
  activeGame,
  currentUserId,
  refresh
}: {
  activeGame: ActiveGame;
  currentUserId: string;
  refresh: () => Promise<void>;
}) {
  const [mode, setMode] = useState<TransferMode>("send");
  const [targetUserId, setTargetUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");

  const playerTargets = useMemo(
    () => activeGame.players.filter((player) => player.userId !== currentUserId),
    [activeGame.players, currentUserId]
  );
  const sortedPlayers = useMemo(
    () => [...activeGame.players].sort((a, b) => b.balance - a.balance),
    [activeGame.players]
  );

  async function submitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const chosenTarget = targetUserId;
    setMessage("");
    try {
      await postJson("/api/transactions", {
        gameId: activeGame.id,
        targetUserId: chosenTarget,
        mode,
        amount
      });
      setAmount("");
      setTargetUserId("");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to create transfer.");
    }
  }

  async function respond(transactionId: string, decision: "accept" | "decline") {
    setMessage("");
    try {
      await postJson("/api/transactions/respond", { transactionId, decision });
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to respond.");
    }
  }

  return (
    <section className="panel wide">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Game Name</p>
          <h2>{activeGame.name}</h2>
        </div>
        <div className="player-balance-actions">
          <div className="balance-pill">
            <Banknote size={18} />
            {activeGame.wallet.balanceLabel}
          </div>
          <button className="icon-button" title="Refresh" onClick={() => void refresh()}>
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      <div className="bank-grid">
        <div className="bank-section">
          <div className="section-title-row">
            <h3>Transfer</h3>
            {activeGame.centralBankEnabled && activeGame.bank && (
              <span className="bank-chip">
                <Landmark size={14} />
                BANK enabled
              </span>
            )}
          </div>
          <form className="stack" onSubmit={submitTransfer}>
            <div className="segmented small">
              <button className={mode === "send" ? "active" : ""} type="button" onClick={() => setMode("send")}>
                <Send size={15} />
                Send
              </button>
              <button className={mode === "request" ? "active" : ""} type="button" onClick={() => setMode("request")}>
                <Banknote size={15} />
                Request
              </button>
            </div>
            <label>
              Player or BANK
              <select value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} required>
                <option value="">Select player or BANK</option>
                {activeGame.centralBankEnabled && activeGame.bank && (
                  <option value={activeGame.bank.userId}>BANK (Central bank)</option>
                )}
                {playerTargets.map((player) => (
                  <option key={player.userId} value={player.userId}>
                    {player.username}
                  </option>
                ))}
              </select>
            </label>
            {activeGame.centralBankEnabled && !activeGame.bank && (
              <p className="form-message">Central bank is enabled, but BANK is not ready for this game yet.</p>
            )}
            <label>
              Amount
              <input value={amount} onChange={(event) => setAmount(event.target.value)} />
            </label>
            {message && <p className="form-message">{message}</p>}
            <button className="primary-button" type="submit">
              <Send size={16} />
              Initiate
            </button>
          </form>
        </div>

        <div className="bank-section">
          <h3>Notifications</h3>
          <div className="notice-list">
            {activeGame.pendingNotifications.length === 0 && <EmptyState label="No pending approvals" />}
            {activeGame.pendingNotifications.map((tx) => (
              <article className="notice" key={tx.id}>
                <div>
                  <strong>{tx.amountLabel}</strong>
                  <p>
                    {tx.fromUsername} → {tx.toUsername}
                  </p>
                </div>
                <div className="row-actions">
                  <button className="icon-button success" title="Accept" onClick={() => void respond(tx.id, "accept")}>
                    <Check size={17} />
                  </button>
                  <button className="icon-button danger" title="Decline" onClick={() => void respond(tx.id, "decline")}>
                    <X size={17} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="bank-section">
          <h3>Players</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {sortedPlayers.map((player) => (
                  <tr key={player.userId}>
                    <td>{player.username}</td>
                    <td>{player.balanceLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <TransactionsTable transactions={activeGame.transactions} currentUserId={currentUserId} />
    </section>
  );
}

function Reports({ reports }: { reports: EndedReport[] }) {
  return (
    <section className="panel wide">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Reports</p>
          <h2>Ended games</h2>
        </div>
        <Landmark size={22} />
      </div>
      {reports.length === 0 && <EmptyState label="No ended games yet" />}
      <div className="reports">
        {reports.map((report) => (
          <article className="report" key={report.id}>
            <div className="report-head">
              <div>
                <h3>{report.name}</h3>
                <p>
                  Ended {niceDate(report.endedAt)} · volume {report.acceptedVolumeLabel}
                </p>
              </div>
              <span className="status-badge ended">{report.acceptedCount} accepted</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Final</th>
                    <th>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {report.players.map((player) => (
                    <tr key={player.userId}>
                      <td>{player.username}</td>
                      <td>{player.finalBalanceLabel}</td>
                      <td>{player.netLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))}
      </div>
    </section>
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
  const visibleTransactions = useMemo(() => {
    const needle = transactionSearch.trim().toLowerCase();
    return [...transactions]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .filter((tx) => {
        if (!needle) {
          return true;
        }

        return [
          tx.fromUsername,
          tx.toUsername,
          tx.initiatorUsername,
          tx.mode,
          tx.amountLabel,
          tx.status,
          niceDate(tx.createdAt)
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      });
  }, [transactions, transactionSearch]);

  return (
    <div className="player-transactions-section">
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
            {visibleTransactions.length === 0 && (
              <tr>
                <td colSpan={showActions ? 7 : 6}>
                  {transactionSearch.trim() ? "No transactions found" : "No transactions yet"}
                </td>
              </tr>
            )}
            {visibleTransactions.map((tx) => {
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
                  <td>{niceDate(tx.createdAt)}</td>
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
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="empty">{label}</div>;
}

function StatusBadge({ status }: { status: Game["status"] }) {
  return <span className={`status-badge ${status}`}>{status}</span>;
}
