import { useEffect, useMemo, useState } from 'react';
import { loadScheduleFromCsv } from './data/kampongBloeSchedule';
import {
  QUARTER_LENGTH_SECONDS,
  advanceQuarter,
  applyManualSubstitution,
  buildDefaultPlayers,
  buildDefaultPlayersFromSchedule,
  createEmptyRotation,
  deferPlannedSubstitution,
  formatClock,
  getCurrentPlayersOn,
  getOffFieldPlayers,
  getOnCountForSlot,
  getPlayerIntel,
  getPositionGroupCounts,
  getQuarterMinute,
  getQuarterSummary,
  getSecondsUntilSubstitution,
  getUpcomingSubstitutions,
  initialisePlan,
  initialisePlanForSchedule,
  quarterOrder,
  toggleRotationCell,
} from './engine/matchEngine';
import { loadMatchState, saveMatchState } from './storage/localStore';
import type { MatchState, Player, Quarter } from './types';

const createDefaultState = (): MatchState => {
  const players = buildDefaultPlayers();
  const planned = initialisePlan(players);
  const actual = createEmptyRotation(players);

  players.forEach((player) => {
    actual[player.id] = [...planned[player.id]];
  });

  return {
    matchTitle: 'KAMPONG BLOE',
    opponent: 'ABN',
    matchDate: '',
    venue: '',
    scoreHome: 0,
    scoreAway: 0,
    quarter: 'Q1',
    clockSeconds: QUARTER_LENGTH_SECONDS,
    isRunning: false,
    players,
    plannedRotation: planned,
    actualRotation: actual,
    viewMode: 'planned',
    eventHistory: [],
    pendingQueue: [],
    selectedPlayerId: players[0]?.id ?? null,
    undoStack: [],
  };
};

const makeSnapshot = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type TabName = 'live' | 'plan' | 'setup';
type SubReason = 'Injury' | 'Fatigue' | 'Performance' | 'Tactical' | 'Other';

const SUB_REASON_OPTIONS: SubReason[] = ['Injury', 'Fatigue', 'Performance', 'Tactical', 'Other'];

function App() {
  const [match, setMatch] = useState<MatchState>(() => loadMatchState() ?? createDefaultState());
  const [scheduleReady, setScheduleReady] = useState(() => loadMatchState() !== null);
  const [activeTab, setActiveTab] = useState<TabName>('live');
  const [substituteOffId, setSubstituteOffId] = useState('');
  const [substituteOnId, setSubstituteOnId] = useState('');
  const [substituteReason, setSubstituteReason] = useState<SubReason>('Fatigue');
  const [draftPlayer, setDraftPlayer] = useState({
    name: '',
    number: 0,
    primaryPosition: 'Midfield',
    secondaryPosition: 'Half',
    positionGroup: 'MIDFIELDERS',
  });

  useEffect(() => {
    if (scheduleReady) saveMatchState(match);
  }, [match, scheduleReady]);

  useEffect(() => {
    if (scheduleReady) return;
    let cancelled = false;

    void loadScheduleFromCsv().then((schedule) => {
      if (cancelled) return;

      setMatch((previous) => {
        const players = buildDefaultPlayersFromSchedule(schedule);
        const planned = initialisePlanForSchedule(players, schedule);
        const actual = createEmptyRotation(players);

        players.forEach((player) => {
          actual[player.id] = [...(planned[player.id] ?? [])];
        });

        return {
          ...previous,
          players,
          plannedRotation: planned,
          actualRotation: actual,
          selectedPlayerId: players.some((player) => player.id === previous.selectedPlayerId)
            ? previous.selectedPlayerId : players[0]?.id ?? null,
        };
      });
      setScheduleReady(true);
    });
    return () => { cancelled = true; };
  }, [scheduleReady]);

  useEffect(() => {
    if (!match.isRunning) return;

    const timer = window.setInterval(() => {
      setMatch((previous) => {
        if (!previous.isRunning) return previous;

        const nextClock = previous.clockSeconds - 1;
        if (nextClock > 0) {
          return { ...previous, clockSeconds: nextClock };
        }

        const quarterIndex = quarterOrder.indexOf(previous.quarter);
        if (quarterIndex < quarterOrder.length - 1) {
          return {
            ...previous,
            quarter: quarterOrder[quarterIndex + 1],
            clockSeconds: QUARTER_LENGTH_SECONDS,
            isRunning: false,
          };
        }

        return {
          ...previous,
          clockSeconds: 0,
          isRunning: false,
        };
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [match.isRunning]);

  const activeRotation = match.viewMode === 'planned' ? match.plannedRotation : match.actualRotation;

  const quarterSummary = useMemo(
    () => getQuarterSummary(match.players, activeRotation, match.quarter),
    [match.players, activeRotation, match.quarter],
  );

  const currentMinute = getQuarterMinute(match);
  const currentOnCount = getOnCountForSlot(match.players, activeRotation, currentMinute.slotIndex);
  const queue = useMemo(() => getUpcomingSubstitutions(match), [match]);
  const selectedPlayer = match.players.find((player) => player.id === match.selectedPlayerId) ?? match.players[0];
  const orderedPlayers = useMemo(
    () => [...match.players].sort((left, right) => {
      const leftOn = activeRotation[left.id]?.[currentMinute.slotIndex] ?? false;
      const rightOn = activeRotation[right.id]?.[currentMinute.slotIndex] ?? false;
      return Number(rightOn) - Number(leftOn) || left.number - right.number;
    }),
    [match.players, activeRotation, currentMinute.slotIndex],
  );

  const tacticalIntel = useMemo(
    () => getPlayerIntel(match.players, activeRotation, currentMinute.slotIndex).sort((left, right) => {
      const leftActive = left.isOn ? 1 : 0;
      const rightActive = right.isOn ? 1 : 0;
      const riskWeight = { 'at-risk': 3, watch: 2, fresh: 1 };
      return rightActive - leftActive || riskWeight[right.risk] - riskWeight[left.risk] || right.totalMinutes - left.totalMinutes;
    }).slice(0, 5),
    [match.players, activeRotation, currentMinute.slotIndex],
  );
  const positionBalance = useMemo(
    () => Object.entries(getPositionGroupCounts(match.players, activeRotation, currentMinute.slotIndex)).sort(([left], [right]) => left.localeCompare(right)),
    [match.players, activeRotation, currentMinute.slotIndex],
  );
  const selectedPlayerIntel = useMemo(
    () => getPlayerIntel(match.players, activeRotation, currentMinute.slotIndex).find((entry) => entry.playerId === selectedPlayer?.id),
    [match.players, activeRotation, currentMinute.slotIndex, selectedPlayer?.id],
  );

  const mutateState = (mutator: (prev: MatchState) => MatchState) => {
    setMatch((previous) => {
      const snapshot = makeSnapshot(previous);
      const next = mutator(previous);
      if (next === previous) return previous;
      return {
        ...next,
        undoStack: [snapshot, ...previous.undoStack].slice(0, 20),
      };
    });
  };

  const handleToggleCell = (playerId: string, slotIndex: number) => {
    mutateState((previous) => toggleRotationCell(previous, playerId, slotIndex));
  };

  const handleQuarterChange = (quarter: Quarter) => {
    mutateState((previous) => ({
      ...previous,
      quarter,
      clockSeconds: QUARTER_LENGTH_SECONDS,
      isRunning: false,
    }));
  };

  const handleAddScore = (team: 'home' | 'away') => {
    mutateState((previous) => ({
      ...previous,
      scoreHome: team === 'home' ? previous.scoreHome + 1 : previous.scoreHome,
      scoreAway: team === 'away' ? previous.scoreAway + 1 : previous.scoreAway,
    }));
  };

  const handleTickClock = (deltaSeconds: number) => {
    mutateState((previous) => ({
      ...previous,
      clockSeconds: Math.min(QUARTER_LENGTH_SECONDS, Math.max(0, previous.clockSeconds + deltaSeconds)),
    }));
  };

  const handleToggleClock = () => {
    setMatch((previous) => ({
      ...previous,
      isRunning: !previous.isRunning,
    }));
  };

  const handleMatchFieldChange = (field: 'matchTitle' | 'opponent' | 'matchDate' | 'venue', value: string) => {
    setMatch((previous) => ({
      ...previous,
      [field]: value,
    }));
  };

  const handleUndo = () => {
    setMatch((previous) => {
      if (previous.undoStack.length === 0) return previous;
      const [previousSnapshot, ...rest] = previous.undoStack;
      return {
        ...previousSnapshot,
        undoStack: rest,
      };
    });
  };

  const handleResetMatch = () => {
    setMatch(createDefaultState());
  };

  const handleManualSub = (playerOutId: string, playerInId: string) => {
    mutateState((previous) => {
      const next = applyManualSubstitution(previous, playerOutId, playerInId);
      return next;
    });
  };

  const handleQueueAction = (action: 'call' | 'confirm' | 'delay' | 'cancel', itemId: string) => {
    mutateState((previous) => {
      const item = getUpcomingSubstitutions(previous).find((entry) => entry.id === itemId);
      if (!item) return previous;
      const otherOverrides = previous.pendingQueue.filter((entry) => entry.id !== itemId);

      if (action === 'call') {
        if (item.status === 'called' || item.status === 'confirmed' || item.status === 'cancelled') return previous;
        return { ...previous, pendingQueue: [...otherOverrides, { ...item, status: 'called' }] };
      }

      if (action === 'confirm') {
        if (item.status !== 'called') return previous;
        const updated = applyManualSubstitution(previous, item.playerOutId, item.playerInId);
        if (updated === previous) return previous;
        return { ...updated, pendingQueue: [...otherOverrides, { ...item, status: 'confirmed' }] };
      }

      if (action === 'delay') {
        const nextQuarterIndex = quarterOrder.indexOf(item.quarter) + 1;
        if (item.minute === 15 && nextQuarterIndex >= quarterOrder.length) return previous;
        const quarter = item.minute === 15 ? quarterOrder[nextQuarterIndex] : item.quarter;
        const minute = item.minute === 15 ? 1 : item.minute + 1;
        const targetSlot = quarterOrder.indexOf(quarter) * 15 + minute - 1;
        const updated = deferPlannedSubstitution(previous, item, targetSlot);
        return { ...updated, pendingQueue: [...otherOverrides, { ...item, quarter, minute, status: 'queued' }] };
      }

      const updated = deferPlannedSubstitution(previous, item);
      return { ...updated, pendingQueue: [...otherOverrides, { ...item, status: 'cancelled' }] };
    });
  };

  const playersOnCurrentMinute = getCurrentPlayersOn(match.players, match.actualRotation, currentMinute.slotIndex);
  const playersOffCurrentMinute = getOffFieldPlayers(match.players, match.actualRotation, currentMinute.slotIndex);

  useEffect(() => {
    if (!playersOnCurrentMinute.some((player) => player.id === substituteOffId)) {
      setSubstituteOffId(playersOnCurrentMinute[0]?.id ?? '');
    }
  }, [playersOnCurrentMinute, substituteOffId]);

  useEffect(() => {
    if (!playersOffCurrentMinute.some((player) => player.id === substituteOnId)) {
      setSubstituteOnId(playersOffCurrentMinute[0]?.id ?? '');
    }
  }, [playersOffCurrentMinute, substituteOnId]);

  const selectedPlayerIsActuallyOn = Boolean(selectedPlayer && match.actualRotation[selectedPlayer.id]?.[currentMinute.slotIndex]);

  const handleSubstituteNow = () => {
    if (!substituteOffId || !substituteOnId || substituteOffId === substituteOnId) return;

    mutateState((previous) => {
      const slotIndex = getQuarterMinute(previous).slotIndex;
      const playerOut = previous.players.find((player) => player.id === substituteOffId);
      const playerIn = previous.players.find((player) => player.id === substituteOnId);

      if (!playerOut || !playerIn) return previous;

      const nextActualRotation = { ...previous.actualRotation };
      const playerOutCells = [...(nextActualRotation[playerOut.id] ?? Array.from({ length: 60 }, () => false))];
      const playerInCells = [...(nextActualRotation[playerIn.id] ?? Array.from({ length: 60 }, () => false))];

      if (!playerOutCells[slotIndex] || playerInCells[slotIndex]) return previous;

      playerOutCells[slotIndex] = false;
      playerInCells[slotIndex] = true;

      nextActualRotation[playerOut.id] = playerOutCells;
      nextActualRotation[playerIn.id] = playerInCells;

      const nextEventHistory = [{
        id: `${Date.now()}-${playerOut.id}-${playerIn.id}`,
        quarter: previous.quarter,
        minute: getQuarterMinute(previous).minute,
        playerOutId: playerOut.id,
        playerInId: playerIn.id,
        reason: substituteReason,
        timestamp: Date.now(),
      }, ...previous.eventHistory];

      return {
        ...previous,
        actualRotation: nextActualRotation,
        eventHistory: nextEventHistory,
      };
    });
  };

  const handlePrintGameReport = () => {
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) return;

    const reportRows = match.eventHistory.length === 0
      ? '<tr><td colspan="5">No substitutions recorded.</td></tr>'
      : match.eventHistory.map((event) => {
        const playerOut = match.players.find((player) => player.id === event.playerOutId);
        const playerIn = match.players.find((player) => player.id === event.playerInId);
        return `
          <tr>
            <td>${event.quarter}</td>
            <td>${event.minute}</td>
            <td>${playerOut?.name ?? 'Unknown'}</td>
            <td>${playerIn?.name ?? 'Unknown'}</td>
            <td>${event.reason}</td>
          </tr>
        `;
      }).join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>${match.matchTitle || 'Match report'} - PressPlay</title>
          <style>
            body { font-family: Arial, sans-serif; color: #213e38; margin: 32px; }
            h1 { margin: 0 0 8px; font-size: 24px; }
            .meta { color: #526d65; margin-bottom: 20px; }
            .summary { display: flex; gap: 18px; margin: 18px 0; }
            .summary div { border: 1px solid #cbd9d1; border-radius: 10px; padding: 12px 16px; min-width: 120px; }
            .summary span { display: block; color: #526d65; font-size: 11px; text-transform: uppercase; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #cbd9d1; padding: 8px; text-align: left; }
            th { background: #f5f7f1; }
          </style>
        </head>
        <body>
          <h1>${match.matchTitle || 'Match report'}</h1>
          <div class="meta">${match.opponent ? `vs ${match.opponent}` : 'Opponent TBD'} · ${match.matchDate || 'Date TBD'} · ${match.venue || 'Venue TBD'}</div>
          <div class="summary">
            <div><span>Final score</span><strong>${match.scoreHome} - ${match.scoreAway}</strong></div>
            <div><span>Quarter</span><strong>${match.quarter}</strong></div>
            <div><span>Clock</span><strong>${formatClock(match.clockSeconds)}</strong></div>
          </div>
          <h3>Actual substitutions</h3>
          <table>
            <thead>
              <tr><th>Quarter</th><th>Minute</th><th>Off</th><th>On</th><th>Reason</th></tr>
            </thead>
            <tbody>${reportRows}</tbody>
          </table>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const handleAddPlayer = () => {
    if (!draftPlayer.name.trim()) return;

    const playerId = `${draftPlayer.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
    const newPlayer: Player = {
      id: playerId,
      name: draftPlayer.name.trim(),
      number: draftPlayer.number,
      primaryPosition: draftPlayer.primaryPosition,
      secondaryPosition: draftPlayer.secondaryPosition,
      positionGroup: draftPlayer.positionGroup,
      active: true,
    };

    mutateState((previous) => {
      const nextPlayers = [...previous.players, newPlayer];
      const nextPlanned = { ...previous.plannedRotation };
      const nextActual = { ...previous.actualRotation };
      nextPlanned[newPlayer.id] = Array.from({ length: 60 }, () => false);
      nextActual[newPlayer.id] = Array.from({ length: 60 }, () => false);

      return {
        ...previous,
        players: nextPlayers,
        plannedRotation: nextPlanned,
        actualRotation: nextActual,
        selectedPlayerId: newPlayer.id,
      };
    });

    setDraftPlayer((current) => ({
      ...current,
      name: '',
      number: current.number > 0 ? current.number + 1 : 0,
    }));
  };

  const handleUpdatePlayer = (playerId: string, changes: Partial<Player>) => {
    setMatch((previous) => ({
      ...previous,
      players: previous.players.map((player) => (
        player.id === playerId ? { ...player, ...changes } : player
      )),
    }));
  };

  const handleRemovePlayer = (playerId: string) => {
    mutateState((previous) => {
      const players = previous.players.filter((player) => player.id !== playerId);
      const plannedRotation = { ...previous.plannedRotation };
      const actualRotation = { ...previous.actualRotation };
      delete plannedRotation[playerId];
      delete actualRotation[playerId];
      return {
        ...previous,
        players,
        plannedRotation,
        actualRotation,
        selectedPlayerId: previous.selectedPlayerId === playerId ? players[0]?.id ?? null : previous.selectedPlayerId,
      };
    });
  };

  const handleNewGame = (clearSquad = false) => {
    const fresh = createDefaultState();
    const players = clearSquad ? [] : match.players;
    const plannedRotation = clearSquad ? {} : initialisePlan(players);
    const actualRotation = createEmptyRotation(players);
    players.forEach((player) => {
      actualRotation[player.id] = [...(plannedRotation[player.id] ?? [])];
    });
    setMatch({
      ...fresh,
      players,
      plannedRotation,
      actualRotation,
      selectedPlayerId: players[0]?.id ?? null,
      matchTitle: match.matchTitle || 'Matchday plan',
      opponent: '',
      matchDate: new Date().toISOString().slice(0, 10),
      venue: '',
    });
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="eyebrow">PRESSPLAY</span>
          <h1>{match.matchTitle || 'MATCHDAY'}</h1>
          <div className="header-meta">
            <span>{match.opponent ? `vs ${match.opponent}` : 'Opponent TBD'}</span>
            <span>{match.matchDate || 'Date TBD'}</span>
          </div>
        </div>

        <div className="score-cluster">
          <div className="score-box home">
            <span>HOME</span>
            <strong>{match.scoreHome}</strong>
            <button type="button" onClick={() => handleAddScore('home')}>+1</button>
          </div>
          <div className="score-box away">
            <span>AWAY</span>
            <strong>{match.scoreAway}</strong>
            <button type="button" onClick={() => handleAddScore('away')}>+1</button>
          </div>
        </div>

        <div className="control-panel">
          <div className="quarter-badge">{match.quarter}</div>
          <div className="clock-display">{formatClock(match.clockSeconds)}</div>
          <div className="action-row compact">
            <button type="button" onClick={handleToggleClock}>
              {match.isRunning ? 'PAUSE CLOCK' : 'START CLOCK'}
            </button>
            <button type="button" onClick={() => handleTickClock(-30)}>-30s</button>
            <button type="button" onClick={() => handleTickClock(30)}>+30s</button>
          </div>
        </div>
      </header>

      <nav className="mobile-tabs" aria-label="Match sections">
        <button type="button" className={activeTab === 'live' ? 'tab-button active' : 'tab-button'} onClick={() => setActiveTab('live')}>LIVE</button>
        <button type="button" className={activeTab === 'plan' ? 'tab-button active' : 'tab-button'} onClick={() => setActiveTab('plan')}>PLAN</button>
        <button type="button" className={activeTab === 'setup' ? 'tab-button active' : 'tab-button'} onClick={() => setActiveTab('setup')}>SETUP</button>
      </nav>

      {activeTab === 'live' && (
        <main className="mobile-page">
          <section className="panel-card">
            <div className="section-top-row">
              <h2>LIVE</h2>
              <div className="inline-actions">
                <button type="button" className="print-button" onClick={handlePrintGameReport}>PRINT GAME REPORT</button>
                <button type="button" className="danger" onClick={handleUndo}>UNDO</button>
              </div>
            </div>

            <div className="live-summary-grid">
              <div className="mini-stat">
                <span>Current</span>
                <strong>{currentMinute.quarter} {currentMinute.minute}</strong>
              </div>
              <div className="mini-stat">
                <span>On field</span>
                <strong>{playersOnCurrentMinute.length}/11</strong>
              </div>
              <div className="mini-stat">
                <span>Next</span>
                <strong>{queue[0] ? `${queue[0].quarter} ${String(queue[0].minute).padStart(2, '0')}` : 'None'}</strong>
              </div>
            </div>
          </section>

          <section className="panel-card">
            <h2>Quick sub</h2>
            <div className="live-sub-form">
              <label>
                <span>Player OFF</span>
                <select aria-label="Player OFF" value={substituteOffId} onChange={(event) => setSubstituteOffId(event.target.value)}>
                  {playersOnCurrentMinute.length === 0 ? <option value="">No players on</option> : playersOnCurrentMinute.map((player) => (
                    <option key={player.id} value={player.id}>{player.name}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>Player ON</span>
                <select aria-label="Player ON" value={substituteOnId} onChange={(event) => setSubstituteOnId(event.target.value)}>
                  {playersOffCurrentMinute.length === 0 ? <option value="">No players off</option> : playersOffCurrentMinute.map((player) => (
                    <option key={player.id} value={player.id}>{player.name}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>Reason</span>
                <select aria-label="Reason" value={substituteReason} onChange={(event) => setSubstituteReason(event.target.value as SubReason)}>
                  {SUB_REASON_OPTIONS.map((reason) => (
                    <option key={reason} value={reason}>{reason}</option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                className="primary-action"
                onClick={handleSubstituteNow}
                disabled={!substituteOffId || !substituteOnId || substituteOffId === substituteOnId}
              >
                CONFIRM SUB
              </button>
            </div>
          </section>

          <section className="panel-card">
            <h2>Players on field</h2>
            <div className="chip-list">
              {playersOnCurrentMinute.map((player) => (
                <button key={player.id} type="button" className="chip" onClick={() => setMatch((previous) => ({ ...previous, selectedPlayerId: player.id }))}>
                  {player.name}
                </button>
              ))}
              {playersOnCurrentMinute.length === 0 && <div className="empty-queue">No players currently on the field.</div>}
            </div>
          </section>

          <section className="panel-card">
            <h2>Upcoming substitutions</h2>
            <div className="queue-list">
              {queue.length === 0 ? (
                <div className="empty-queue">No live substitutions due yet.</div>
              ) : (
                queue.map((entry, index) => {
                  const playerOut = match.players.find((player) => player.id === entry.playerOutId);
                  const playerIn = match.players.find((player) => player.id === entry.playerInId);
                  const isFeatured = index === 0;
                  const isCalled = entry.status === 'called';
                  return (
                    <div className={isFeatured ? 'queue-item featured' : 'queue-item compact'} key={entry.id}>
                      <div className="queue-time">{entry.quarter} {String(entry.minute).padStart(2, '0')}:00</div>
                      <div className="queue-line">
                        <span>{playerOut?.name ?? 'Player'}</span>
                        <strong>OUT</strong>
                        <span>{playerIn?.name ?? 'Player'}</span>
                        <strong>IN</strong>
                      </div>
                      <div className="queue-actions">
                        <button
                          type="button"
                          className={isFeatured ? 'primary-action' : 'secondary-action'}
                          onClick={() => handleQueueAction('call', entry.id)}
                          disabled={entry.status === 'called' || entry.status === 'confirmed' || entry.status === 'cancelled'}
                        >
                          {isCalled ? 'CALLED' : 'CALL TO SIDELINE'}
                        </button>
                        <button
                          type="button"
                          className={isFeatured ? 'primary-action alt' : 'secondary-action'}
                          onClick={() => handleQueueAction('confirm', entry.id)}
                          disabled={entry.status !== 'called'}
                        >
                          CONFIRM SUB
                        </button>
                        <button type="button" className="secondary-action" onClick={() => handleQueueAction('delay', entry.id)}>DELAY</button>
                        <button type="button" className="secondary-action" onClick={() => handleQueueAction('cancel', entry.id)}>CANCEL</button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="panel-card">
            <h2>Event history</h2>
            <div className="history-list">
              {match.eventHistory.length === 0 ? (
                <div className="empty-queue">No substitutions logged yet.</div>
              ) : (
                match.eventHistory.slice(0, 8).map((event) => {
                  const playerOut = match.players.find((player) => player.id === event.playerOutId);
                  const playerIn = match.players.find((player) => player.id === event.playerInId);
                  return (
                    <div key={event.id} className="history-item">
                      <span>{event.quarter} {event.minute}:00</span>
                      <strong>{playerOut?.name ?? 'Player'} → {playerIn?.name ?? 'Player'}</strong>
                      <small>{event.reason}</small>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </main>
      )}

      {activeTab === 'plan' && (
        <main className="mobile-page">
          <section className="panel-card plan-panel">
            <div className="section-top-row">
              <div>
                <span className="panel-label">Quarter</span>
                <div className="segment-row">
                  {quarterOrder.map((quarter) => (
                    <button key={quarter} type="button" className={match.quarter === quarter ? 'segment active' : 'segment'} onClick={() => handleQuarterChange(quarter)}>
                      {quarter}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" className="print-button" onClick={() => window.print()}>Print planned sheet</button>
            </div>

            <div className="grid-wrapper">
              <div className="grid-header-row">
                <div className="player-label header">PLAYER</div>
                {Array.from({ length: 15 }, (_, index) => {
                  const minute = index + 1;
                  return <div key={minute} className={currentMinute.minute === minute ? 'minute-cell now' : 'minute-cell'}>{minute}</div>;
                })}
              </div>

              {orderedPlayers.map((player) => (
                <div key={player.id} className="player-row">
                  <button type="button" className={match.selectedPlayerId === player.id ? 'player-name active' : 'player-name'} onClick={() => setMatch((previous) => ({ ...previous, selectedPlayerId: player.id }))}>
                    <span className="number">{player.number || '—'}</span>
                    <span>{player.name}</span>
                  </button>

                  {Array.from({ length: 15 }, (_, minuteIndex) => {
                    const slotIndex = quarterOrder.indexOf(match.quarter) * 15 + minuteIndex;
                    const isOn = match.plannedRotation[player.id]?.[slotIndex] ?? false;
                    const isCurrent = currentMinute.slotIndex === slotIndex;
                    return (
                      <button
                        key={`${player.id}-${minuteIndex}`}
                        type="button"
                        className={isOn ? 'cell on' : 'cell off'}
                        data-now={isCurrent ? 'true' : 'false'}
                        onClick={() => handleToggleCell(player.id, slotIndex)}
                        title={`${player.name} minute ${minuteIndex + 1} ${isOn ? 'ON' : 'OFF'}`}
                      >
                        <span aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>
        </main>
      )}

      {activeTab === 'setup' && (
        <main className="mobile-page">
          <section className="panel-card">
            <h2>Match details</h2>
            <div className="setup-form-grid">
              <input type="text" value={match.matchTitle ?? ''} placeholder="Match title" onChange={(event) => handleMatchFieldChange('matchTitle', event.target.value)} />
              <input type="text" value={match.opponent ?? ''} placeholder="Opponent" onChange={(event) => handleMatchFieldChange('opponent', event.target.value)} />
              <input type="date" value={match.matchDate ?? ''} onChange={(event) => handleMatchFieldChange('matchDate', event.target.value)} />
              <input type="text" value={match.venue ?? ''} placeholder="Venue" onChange={(event) => handleMatchFieldChange('venue', event.target.value)} />
            </div>
          </section>

          <section className="panel-card">
            <h2>Squad setup</h2>
            <div className="player-form">
              <input type="text" value={draftPlayer.name} placeholder="Player name" onChange={(event) => setDraftPlayer((current) => ({ ...current, name: event.target.value }))} />
              <div className="inline-fields">
                <input type="number" min={0} value={draftPlayer.number || ''} placeholder="#" onChange={(event) => setDraftPlayer((current) => ({ ...current, number: Number(event.target.value || 0) }))} />
                <input type="text" value={draftPlayer.positionGroup} placeholder="Group" onChange={(event) => setDraftPlayer((current) => ({ ...current, positionGroup: event.target.value.toUpperCase() }))} />
              </div>
              <div className="inline-fields">
                <input type="text" value={draftPlayer.primaryPosition} placeholder="Primary" onChange={(event) => setDraftPlayer((current) => ({ ...current, primaryPosition: event.target.value }))} />
                <input type="text" value={draftPlayer.secondaryPosition} placeholder="Secondary" onChange={(event) => setDraftPlayer((current) => ({ ...current, secondaryPosition: event.target.value }))} />
              </div>
              <button type="button" onClick={handleAddPlayer}>ADD PLAYER</button>
            </div>

            <div className="squad-editor-list">
              {match.players.map((player) => (
                <div className="squad-editor-row" key={`edit-${player.id}`}>
                  <input type="number" min={0} value={player.number || ''} placeholder="#" onChange={(event) => handleUpdatePlayer(player.id, { number: Number(event.target.value || 0) })} />
                  <input value={player.name} onChange={(event) => handleUpdatePlayer(player.id, { name: event.target.value })} />
                  <button type="button" className="danger remove-player" onClick={() => handleRemovePlayer(player.id)}>REMOVE</button>
                </div>
              ))}
            </div>
          </section>

          <section className="panel-card">
            <h2>Actions</h2>
            <div className="stack-actions">
              <button type="button" className="print-button" onClick={() => window.print()}>Print planned sheet</button>
              <button type="button" onClick={handleResetMatch} className="danger">Reset match</button>
            </div>
          </section>
        </main>
      )}

      <section className="print-sheet game-report-print" aria-label="Game report print view">
        <header className="print-header">
          <div>
            <span>PRESSPLAY</span>
            <h1>{match.matchTitle || 'Match report'}</h1>
          </div>
          <div className="print-meta">
            <strong>{match.opponent ? `vs ${match.opponent}` : 'Opponent: _______________'}</strong>
            <span>{match.matchDate || 'Date: _______________'}</span>
            <span>{match.venue || 'Venue: _______________'}</span>
          </div>
        </header>

        <div className="report-summary">
          <div><span>Final score</span><strong>{match.scoreHome} - {match.scoreAway}</strong></div>
          <div><span>Quarter</span><strong>{match.quarter}</strong></div>
          <div><span>Clock</span><strong>{formatClock(match.clockSeconds)}</strong></div>
        </div>

        <h3 className="report-subtitle">Actual substitutions</h3>
        {match.eventHistory.length === 0 ? (
          <p className="empty-queue">No substitutions recorded.</p>
        ) : (
          <table className="report-table">
            <thead>
              <tr>
                <th>Quarter</th>
                <th>Minute</th>
                <th>Off</th>
                <th>On</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {match.eventHistory.map((event) => {
                const out = match.players.find((player) => player.id === event.playerOutId);
                const inPlayer = match.players.find((player) => player.id === event.playerInId);
                return (
                  <tr key={event.id}>
                    <td>{event.quarter}</td>
                    <td>{event.minute}</td>
                    <td>{out?.name ?? 'Unknown'}</td>
                    <td>{inPlayer?.name ?? 'Unknown'}</td>
                    <td>{event.reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="print-sheet plan-print" aria-label="Planned lineup sheet">
        <header className="print-header">
          <div>
            <span>PRESSPLAY</span>
            <h1>{match.matchTitle || 'Matchday plan'}</h1>
          </div>
          <div className="print-meta">
            <strong>{match.opponent ? `vs ${match.opponent}` : 'Opponent: ____________________'}</strong>
            <span>{match.matchDate || 'Date: ____________________'}</span>
            <span>{match.venue || 'Venue: ____________________'}</span>
          </div>
        </header>
        <table className="plan-table">
          <thead>
            <tr><th>#</th><th>Player</th>{quarterOrder.map((quarter) => <th key={quarter}>{quarter}</th>)}<th>Total</th></tr>
          </thead>
          <tbody>
            {match.players.map((player) => (
              <tr key={`print-${player.id}`}>
                <td>{player.number || '—'}</td>
                <td>{player.name}</td>
                {quarterOrder.map((quarter, quarterIndex) => (
                  <td key={`${player.id}-${quarter}`}>
                    <div className="print-minute-grid">
                      {Array.from({ length: 15 }, (_, minuteIndex) => {
                        const slotIndex = quarterIndex * 15 + minuteIndex;
                        return <span key={slotIndex} className={match.plannedRotation[player.id]?.[slotIndex] ? 'planned-on' : ''}>{minuteIndex + 1}</span>;
                      })}
                    </div>
                  </td>
                ))}
                <td><strong>{match.plannedRotation[player.id]?.filter(Boolean).length ?? 0}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export default App;
