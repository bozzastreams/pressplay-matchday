import type { MatchState, PendingSubstitution, Player, PlannedRotation, Quarter } from '../types';

export const quarterOrder: Quarter[] = ['Q1', 'Q2', 'Q3', 'Q4'];
export const QUARTER_MINUTES = 15;
export const QUARTER_LENGTH_SECONDS = 15 * 60;
export const MIN_PLAYER_COUNT = 11;

export const getQuarterIndex = (quarter: Quarter): number => quarterOrder.indexOf(quarter);

export const getSlotIndex = (quarter: Quarter, minute: number): number => {
  return getQuarterIndex(quarter) * QUARTER_MINUTES + minute;
};

export const getSlotFromState = (state: MatchState): number => {
  const quarterIndex = getQuarterIndex(state.quarter);
  const elapsed = QUARTER_LENGTH_SECONDS - state.clockSeconds;
  const minuteIndex = Math.min(QUARTER_MINUTES - 1, Math.floor(elapsed / 60));
  return quarterIndex * QUARTER_MINUTES + minuteIndex;
};

export const getQuarterMinute = (state: MatchState): { quarter: Quarter; minute: number; slotIndex: number } => {
  const quarterIndex = getQuarterIndex(state.quarter);
  const elapsed = QUARTER_LENGTH_SECONDS - state.clockSeconds;
  const minute = Math.min(QUARTER_MINUTES, Math.floor(elapsed / 60) + 1);
  const slotIndex = quarterIndex * QUARTER_MINUTES + (minute - 1);
  return { quarter: state.quarter, minute, slotIndex };
};

export const formatClock = (seconds: number): string => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};

export const buildDefaultPlayers = (): Player[] => [
  { id: 'noor', name: 'Noor', number: 2, primaryPosition: 'Left Half', secondaryPosition: 'Midfield', positionGroup: 'MIDFIELDERS', active: true },
  { id: 'fiep', name: 'Fiep', number: 4, primaryPosition: 'Right Half', secondaryPosition: 'Defender', positionGroup: 'DEFENDERS', active: true },
  { id: 'imme', name: 'Imme', number: 6, primaryPosition: 'Centre Back', secondaryPosition: 'Defender', positionGroup: 'DEFENDERS', active: true },
  { id: 'sien', name: 'Sien', number: 8, primaryPosition: 'Midfield', secondaryPosition: 'Wide', positionGroup: 'MIDFIELDERS', active: true },
  { id: 'lars', name: 'Lars', number: 9, primaryPosition: 'Forward', secondaryPosition: 'Inside Forward', positionGroup: 'FORWARDS', active: true },
  { id: 'tessa', name: 'Tessa', number: 10, primaryPosition: 'Forward', secondaryPosition: 'Striker', positionGroup: 'FORWARDS', active: true },
  { id: 'joep', name: 'Joep', number: 11, primaryPosition: 'Midfield', secondaryPosition: 'Attack', positionGroup: 'MIDFIELDERS', active: true },
  { id: 'hana', name: 'Hana', number: 13, primaryPosition: 'Defender', secondaryPosition: 'Left Back', positionGroup: 'DEFENDERS', active: true },
  { id: 'veda', name: 'Veda', number: 15, primaryPosition: 'Midfield', secondaryPosition: 'Wide', positionGroup: 'MIDFIELDERS', active: true },
  { id: 'omar', name: 'Omar', number: 17, primaryPosition: 'Forward', secondaryPosition: 'Right Wing', positionGroup: 'FORWARDS', active: true },
  { id: 'daan', name: 'Daan', number: 19, primaryPosition: 'Defender', secondaryPosition: 'Centre Back', positionGroup: 'DEFENDERS', active: true },
  { id: 'margo', name: 'Margo', number: 20, primaryPosition: 'Midfield', secondaryPosition: 'Half', positionGroup: 'MIDFIELDERS', active: true },
  { id: 'kian', name: 'Kian', number: 21, primaryPosition: 'Forward', secondaryPosition: 'Striker', positionGroup: 'FORWARDS', active: true },
  { id: 'leen', name: 'Leen', number: 22, primaryPosition: 'Defender', secondaryPosition: 'Right Back', positionGroup: 'DEFENDERS', active: true },
];

export const createEmptyRotation = (players: Player[]): PlannedRotation => {
  return players.reduce((acc, player) => {
    acc[player.id] = Array.from({ length: QUARTER_MINUTES * quarterOrder.length }, () => false);
    return acc;
  }, {} as PlannedRotation);
};

export const initialisePlan = (players: Player[]): PlannedRotation => {
  const rotation = createEmptyRotation(players);
  for (const player of players) {
    for (let slot = 0; slot < rotation[player.id].length; slot += 1) {
      rotation[player.id][slot] = slot < QUARTER_MINUTES * 3 ? false : false;
    }
  }

  players.slice(0, 11).forEach((player) => {
    for (let slot = 0; slot < rotation[player.id].length; slot += 1) {
      rotation[player.id][slot] = true;
    }
  });

  return rotation;
};

export const cloneState = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const getOnCountForSlot = (players: Player[], rotation: PlannedRotation, slotIndex: number): number => {
  return players.filter((player) => rotation[player.id]?.[slotIndex] ?? false).length;
};

export const getQuarterSummary = (players: Player[], rotation: PlannedRotation, quarter: Quarter) => {
  const start = getQuarterIndex(quarter) * QUARTER_MINUTES;
  return Array.from({ length: QUARTER_MINUTES }, (_, minute) => {
    const slotIndex = start + minute;
    const onCount = getOnCountForSlot(players, rotation, slotIndex);
    return {
      slotIndex,
      quarter,
      minute: minute + 1,
      onCount,
      hasError: onCount !== MIN_PLAYER_COUNT,
    };
  });
};

export const toggleRotationCell = (state: MatchState, playerId: string, slotIndex: number): MatchState => {
  const next = cloneState(state);
  next.plannedRotation[playerId] = [...(next.plannedRotation[playerId] ?? Array.from({ length: 60 }, () => false))];
  next.plannedRotation[playerId][slotIndex] = !next.plannedRotation[playerId][slotIndex];
  return next;
};

export const getCurrentPlayersOn = (players: Player[], rotation: PlannedRotation, slotIndex: number): Player[] => {
  return players.filter((player) => rotation[player.id]?.[slotIndex] ?? false);
};

export const getOffFieldPlayers = (players: Player[], rotation: PlannedRotation, slotIndex: number): Player[] => {
  return players.filter((player) => !(rotation[player.id]?.[slotIndex] ?? false));
};

export const getPositionGroupCounts = (players: Player[], rotation: PlannedRotation, slotIndex: number): Record<string, number> => {
  return players.reduce((acc, player) => {
    if (!(rotation[player.id]?.[slotIndex] ?? false)) return acc;
    const group = player.positionGroup || 'OTHER';
    acc[group] = (acc[group] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
};

export const getPlayerIntel = (players: Player[], rotation: PlannedRotation, slotIndex: number) => {
  return players.map((player) => {
    const cells = rotation[player.id] ?? Array.from({ length: 60 }, () => false);
    const isOn = cells[slotIndex] ?? false;
    const totalMinutes = cells.filter(Boolean).length;

    let currentShiftMinutes = 0;
    for (let index = slotIndex; index >= 0; index -= 1) {
      if (cells[index]) currentShiftMinutes += 1;
      else break;
    }

    let restMinutes = 0;
    for (let index = slotIndex; index >= 0; index -= 1) {
      if (!cells[index]) restMinutes += 1;
      else break;
    }

    let risk: 'fresh' | 'watch' | 'at-risk' = 'fresh';
    if (currentShiftMinutes >= 7 || totalMinutes >= 30) risk = 'at-risk';
    else if (currentShiftMinutes >= 4 || totalMinutes >= 18) risk = 'watch';

    return {
      playerId: player.id,
      name: player.name,
      positionGroup: player.positionGroup,
      isOn,
      totalMinutes,
      currentShiftMinutes,
      restMinutes,
      risk,
    };
  });
};

export const getUpcomingSubstitutions = (state: MatchState): PendingSubstitution[] => {
  const visible: PendingSubstitution[] = [];
  const currentSlot = getSlotFromState(state);
  const currentPlayers = state.players;

  for (let slot = currentSlot; slot < currentPlayers.length * 0 + 60; slot += 1) {
    const minute = (slot % QUARTER_MINUTES) + 1;
    const quarter = quarterOrder[Math.floor(slot / QUARTER_MINUTES)];
    currentPlayers.forEach((player) => {
      const previousState = state.plannedRotation[player.id]?.[slot - 1] ?? false;
      const currentState = state.plannedRotation[player.id]?.[slot] ?? false;
      if (previousState && !currentState && slot >= currentSlot) {
        const replacement = currentPlayers.find((candidate) => {
          const wasOn = state.plannedRotation[candidate.id]?.[slot - 1] ?? false;
          const isOn = state.plannedRotation[candidate.id]?.[slot] ?? false;
          return !wasOn && isOn;
        });
        if (replacement) {
          visible.push({
            id: `${player.id}-${slot}`,
            quarter,
            minute,
            playerOutId: player.id,
            playerInId: replacement.id,
            status: 'queued',
          });
        }
      }
    });
  }

  return visible.slice(0, 5);
};

export const applyManualSubstitution = (state: MatchState, playerOutId: string, playerInId: string): MatchState => {
  if (playerOutId === playerInId) return state;
  const next = cloneState(state);
  const playerOut = next.players.find((player) => player.id === playerOutId);
  const playerIn = next.players.find((player) => player.id === playerInId);
  if (!playerOut || !playerIn) return state;

  const { slotIndex } = getQuarterMinute(next);
  const actual = next.actualRotation[playerOutId] ?? Array.from({ length: 60 }, () => false);
  actual[slotIndex] = false;
  next.actualRotation[playerOutId] = actual;

  const incoming = next.actualRotation[playerInId] ?? Array.from({ length: 60 }, () => false);
  incoming[slotIndex] = true;
  next.actualRotation[playerInId] = incoming;

  next.eventHistory.unshift({
    id: `${Date.now()}-${playerOutId}-${playerInId}`,
    quarter: next.quarter,
    minute: getQuarterMinute(next).minute,
    playerOutId,
    playerInId,
    reason: 'Manual',
    timestamp: Date.now(),
  });

  return next;
};

export const advanceQuarter = (quarter: Quarter): Quarter => {
  const index = getQuarterIndex(quarter);
  return quarterOrder[Math.min(index + 1, quarterOrder.length - 1)];
};

export const nextQuarterClock = (quarter: Quarter): number => {
  return QUARTER_LENGTH_SECONDS;
};
