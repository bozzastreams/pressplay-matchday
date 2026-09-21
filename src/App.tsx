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

function App() {
  const [match, setMatch] = useState<MatchState>(() => loadMatchState() ?? createDefaultState());
  const [scheduleReady, setScheduleReady] = useState(() => loadMatchState() !== null);
  const [incomingPlayerId, setIncomingPlayerId] = useState('');
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

  const handleQueueAction = (action: 'confirm' | 'delay' | 'cancel' | 'acknowledge', itemId: string) => {
    mutateState((previous) => {
      const item = getUpcomingSubstitutions(previous).find((entry) => entry.id === itemId);
      if (!item) return previous;
      const otherOverrides = previous.pendingQueue.filter((entry) => entry.id !== itemId);
      const secondsUntil = getSecondsUntilSubstitution(previous, item);

      if (action === 'acknowledge') {
        if (item.status === 'due' || secondsUntil > 30 || secondsUntil <= -60) return previous;
        return { ...previous, pendingQueue: [...otherOverrides, { ...item, status: 'due' }] };
      }

      if (action === 'confirm') {
        if (item.status !== 'due') return previous;
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

  const playersOnCurrentMinute = getCurrentPlayersOn(match.players, activeRotation, currentMinute.slotIndex);
  const actualOffFieldPlayers = getOffFieldPlayers(match.players, match.actualRotation, currentMinute.slotIndex);
  const selectedIncomingId = actualOffFieldPlayers.some((player) => player.id === incomingPlayerId)
    ? incomingPlayerId : actualOffFieldPlayers[0]?.id ?? '';
  const selectedPlayerIsActuallyOn = Boolean(selectedPlayer && match.actualRotation[selectedPlayer.id]?.[currentMinute.slotIndex]);

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

      <section className="game-setup screen-only">
        <div>
          <span className="panel-label">MATCH SETUP</span>
          <div className="game-fields">
            <input
              type="text"
              value={match.matchTitle ?? ''}
              placeholder="Match title"
              onChange={(event) => handleMatchFieldChange('matchTitle', event.target.value)}
            />
            <input
              type="text"
              value={match.opponent ?? ''}
              placeholder="Opponent"
              onChange={(event) => handleMatchFieldChange('opponent', event.target.value)}
            />
            <input
              type="date"
              value={match.matchDate ?? ''}
              onChange={(event) => handleMatchFieldChange('matchDate', event.target.value)}
            />
            <input
              type="text"
              value={match.venue ?? ''}
              placeholder="Venue"
              onChange={(event) => handleMatchFieldChange('venue', event.target.value)}
            />
          </div>
        </div>
        <div className="game-actions">
          <button type="button" className="print-button" onClick={() => window.print()}>
            PRINT PLANNED SHEET
          </button>
          <button type="button" onClick={handleToggleClock}>
            {match.isRunning ? 'PAUSE MATCH CLOCK' : 'START MATCH CLOCK'}
          </button>
          <button type="button" className="danger" onClick={handleResetMatch}>
            RESET MATCH
          </button>
        </div>
      </section>

      <main className="layout">
        <section className="main-panel">
          <div className="panel-header">
            <div>
              <span className="panel-label">QUARTER</span>
              <div className="segment-row">
                {quarterOrder.map((quarter) => (
                  <button
                    key={quarter}
                    type="button"
                    className={match.quarter === quarter ? 'segment active' : 'segment'}
                    onClick={() => handleQuarterChange(quarter)}
                  >
                    {quarter}
                  </button>
                ))}
              </div>
            </div>

            <div className="segment-row align-right">
              <button
                type="button"
                className={match.viewMode === 'planned' ? 'segment active' : 'segment'}
                onClick={() => mutateState((previous) => ({ ...previous, viewMode: 'planned' }))}
              >
                PLANNED
              </button>
              <button
                type="button"
                className={match.viewMode === 'actual' ? 'segment active' : 'segment'}
                onClick={() => mutateState((previous) => ({ ...previous, viewMode: 'actual' }))}
              >
                ACTUAL
              </button>
            </div>

            <div className="header-buttons">
              <button type="button" onClick={() => setMatch((previous) => ({ ...previous, quarter: advanceQuarter(previous.quarter), clockSeconds: QUARTER_LENGTH_SECONDS, isRunning: false }))}>
                NEXT QUARTER
              </button>
              <button type="button" className="danger" onClick={handleUndo}>
                UNDO LAST ACTION
              </button>
            </div>
          </div>

          <div className="grid-wrapper">
            <div className="grid-header-row">
              <div className="player-label header">PLAYER</div>
              {Array.from({ length: 15 }, (_, index) => {
                const minute = index + 1;
                const isNowColumn = currentMinute.minute === minute;
                return (
                  <div key={minute} className={isNowColumn ? 'minute-cell now' : 'minute-cell'}>
                    {minute}
                  </div>
                );
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
                  const isOn = activeRotation[player.id]?.[slotIndex] ?? false;
                  const isCurrent = currentMinute.slotIndex === slotIndex;
                  return (
                    <button
                      key={`${player.id}-${minuteIndex}`}
                      type="button"
                      className={isOn ? 'cell on' : 'cell off'}
                      data-now={isCurrent ? 'true' : 'false'}
                      onClick={() => (match.viewMode === 'planned' ? handleToggleCell(player.id, slotIndex) : undefined)}
                      title={`${player.name} minute ${minuteIndex + 1} ${isOn ? 'ON' : 'OFF'}`}
                    >
                      <span aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="status-summary">
            <div className="summary-item">
              <span>PLAYERS ON</span>
              <strong>{currentOnCount}/11</strong>
            </div>
            <div className={currentOnCount === 11 ? 'summary-item' : 'summary-item error'}>
              <span>MINUTE STATUS</span>
              <strong>{currentOnCount === 11 ? 'VALID' : 'ERROR'}</strong>
            </div>
            <div className="summary-item">
              <span>NOW</span>
              <strong>{currentMinute.minute}</strong>
            </div>
          </div>
        </section>

        <aside className="side-panel">
          <div className="panel-card">
            <h2>NEXT SUBSTITUTIONS</h2>
            <p className="queue-help">Delay and cancel update the live lineup. The printed plan stays unchanged.</p>
            <div className="queue-list">
              {queue.length === 0 ? (
                <div className="empty-queue">No substitutions due yet.</div>
              ) : (
                queue.map((entry) => {
                  const playerOut = match.players.find((player) => player.id === entry.playerOutId);
                  const playerIn = match.players.find((player) => player.id === entry.playerInId);
                  const acknowledged = entry.status === 'due';
                  const secondsUntil = getSecondsUntilSubstitution(match, entry);
                  const canAcknowledge = secondsUntil <= 30 && secondsUntil > -60;
                  return (
                    <div className="queue-item" key={entry.id}>
                      <div className="queue-time">{entry.quarter} {String(entry.minute).padStart(2, '0')}:00</div>
                      <div className="queue-line">
                        <span>{playerOut?.name ?? 'Player'}</span>
                        <strong>OUT</strong>
                        <span>{playerIn?.name ?? 'Player'}</span>
                        <strong>IN</strong>
                      </div>
                      <div className="queue-actions">
                        <button type="button" onClick={() => handleQueueAction('acknowledge', entry.id)} disabled={!canAcknowledge || acknowledged}>
                          {acknowledged ? 'ACKED' : canAcknowledge ? 'ACK' : 'WAIT'}
                        </button>
                        <button type="button" onClick={() => handleQueueAction('confirm', entry.id)} disabled={!acknowledged}>CONFIRM</button>
                        <button type="button" onClick={() => handleQueueAction('delay', entry.id)}>DELAY</button>
                        <button type="button" onClick={() => handleQueueAction('cancel', entry.id)}>CANCEL</button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="panel-card">
            <h2>PLAYER STATUS</h2>
            {selectedPlayer && (
              <div className="player-summary">
                <div className="name-row">
                  <span className="number">#{selectedPlayer.number || '—'}</span>
                  <strong>{selectedPlayer.name}</strong>
                </div>
                <div className="status-grid">
                  <div><span>ON</span><strong>{selectedPlayerIntel?.isOn ? 'YES' : 'NO'}</strong></div>
                  <div><span>SHIFT</span><strong>{selectedPlayerIntel?.currentShiftMinutes ?? 0} mins</strong></div>
                  <div><span>TOTAL</span><strong>{selectedPlayerIntel?.totalMinutes ?? 0} mins</strong></div>
                  <div><span>REST</span><strong>{selectedPlayerIntel?.restMinutes ?? 0} mins</strong></div>
                </div>
                <div className="player-actions">
                  <select aria-label="Player coming on" value={selectedIncomingId} onChange={(event) => setIncomingPlayerId(event.target.value)}>
                    {actualOffFieldPlayers.map((player) => <option key={player.id} value={player.id}>{player.name} IN</option>)}
                  </select>
                  <button type="button" disabled={!selectedPlayerIsActuallyOn || !selectedIncomingId} onClick={() => handleManualSub(selectedPlayer.id, selectedIncomingId)}>
                    SUB NOW
                  </button>
                  <button type="button" onClick={() => handleToggleCell(selectedPlayer.id, currentMinute.slotIndex)}>TOGGLE PLAN</button>
                </div>
              </div>
            )}
          </div>

          <div className="panel-card">
            <h2>SQUAD SETUP</h2>
            <div className="player-form">
              <input
                type="text"
                value={draftPlayer.name}
                placeholder="Player name"
                onChange={(event) => setDraftPlayer((current) => ({ ...current, name: event.target.value }))}
              />
              <div className="inline-fields">
                <input
                  type="number"
                  min={0}
                  value={draftPlayer.number || ''}
                  placeholder="#"
                  onChange={(event) => setDraftPlayer((current) => ({ ...current, number: Number(event.target.value || 0) }))}
                />
                <input
                  type="text"
                  value={draftPlayer.positionGroup}
                  placeholder="Group"
                  onChange={(event) => setDraftPlayer((current) => ({ ...current, positionGroup: event.target.value.toUpperCase() }))}
                />
              </div>
              <div className="inline-fields">
                <input
                  type="text"
                  value={draftPlayer.primaryPosition}
                  placeholder="Primary"
                  onChange={(event) => setDraftPlayer((current) => ({ ...current, primaryPosition: event.target.value }))}
                />
                <input
                  type="text"
                  value={draftPlayer.secondaryPosition}
                  placeholder="Secondary"
                  onChange={(event) => setDraftPlayer((current) => ({ ...current, secondaryPosition: event.target.value }))}
                />
              </div>
              <button type="button" onClick={handleAddPlayer}>ADD PLAYER</button>
            </div>
            <div className="squad-editor-list">
              {match.players.map((player) => (
                <div className="squad-editor-row" key={`edit-${player.id}`}>
                  <input
                    aria-label={`${player.name} shirt number`}
                    type="number"
                    min={0}
                    value={player.number || ''}
                    placeholder="#"
                    onChange={(event) => handleUpdatePlayer(player.id, { number: Number(event.target.value || 0) })}
                  />
                  <input
                    aria-label={`${player.name} player name`}
                    value={player.name}
                    onChange={(event) => handleUpdatePlayer(player.id, { name: event.target.value })}
                  />
                  <button type="button" className="danger remove-player" onClick={() => handleRemovePlayer(player.id)}>REMOVE</button>
                </div>
              ))}
              {match.players.length === 0 && <div className="empty-queue">Add the players selected for this game.</div>}
            </div>
          </div>

          <div className="panel-card">
            <h2>TACTICAL INTELLIGENCE</h2>
            <div className="intel-grid">
              <div className="intel-panel">
                <h3>POSITION BALANCE</h3>
                {positionBalance.length > 0 ? (
                  positionBalance.map(([group, count]) => (
                    <div key={group} className="intel-row">
                      <span>{group}</span>
                      <strong>{count}</strong>
                    </div>
                  ))
                ) : (
                  <div className="empty-queue">No players on court.</div>
                )}
              </div>
              <div className="intel-panel">
                <h3>SUB RISK</h3>
                {tacticalIntel.length > 0 ? (
                  tacticalIntel.map((entry) => (
                    <div key={entry.playerId} className="intel-row risk-row">
                      <span>{entry.name}</span>
                      <strong className={`risk-pill ${entry.risk}`}>{entry.risk}</strong>
                    </div>
                  ))
                ) : (
                  <div className="empty-queue">No rotation data.</div>
                )}
              </div>
            </div>
          </div>

          <div className="panel-card">
            <h2>ACTIVE PLAYERS</h2>
            <div className="chip-list">
              {playersOnCurrentMinute.map((player) => (
                <button key={player.id} type="button" className="chip" onClick={() => setMatch((previous) => ({ ...previous, selectedPlayerId: player.id }))}>
                  {player.name}
                </button>
              ))}
            </div>
          </div>

          <div className="panel-card">
            <h2>TEAM SNAPSHOT</h2>
            <div className="status-grid">
              <div>
                <span>ON COURT</span>
                <strong>{playersOnCurrentMinute.length}</strong>
              </div>
              <div>
                <span>OFF COURT</span>
                <strong>{Math.max(0, match.players.length - playersOnCurrentMinute.length)}</strong>
              </div>
              <div>
                <span>OPPONENT</span>
                <strong>{match.opponent || 'TBD'}</strong>
              </div>
              <div>
                <span>VENUE</span>
                <strong>{match.venue || 'TBD'}</strong>
              </div>
            </div>
          </div>

          <div className="panel-card">
            <h2>EVENT HISTORY</h2>
            <div className="history-list">
              {match.eventHistory.length === 0 ? (
                <div className="empty-queue">No substitutions logged yet.</div>
              ) : (
                match.eventHistory.slice(0, 8).map((event) => (
                  <div key={event.id} className="history-item">
                    <span>{event.quarter} {event.minute}:00</span>
                    <strong>{event.playerOutId ? event.playerOutId.toUpperCase() : 'PLAYER'}</strong>
                    <span>{event.playerInId ? '→ ' + event.playerInId.toUpperCase() : ''}</span>
                    <small>{event.reason}</small>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </main>

      <section className="print-sheet" aria-label="Printable planned lineup sheet">
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
        <footer className="print-footer">Green minutes = planned on field · Print generated from PRESSPLAY MATCHDAY</footer>
      </section>
    </div>
  );
}

export default App;
