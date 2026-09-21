import { KAMPONG_BLOE_SCHEDULE, type ScheduleEntry } from '../data/kampongBloeSchedule';
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

export const buildDefaultPlayersFromSchedule = (schedule: ScheduleEntry[] = KAMPONG_BLOE_SCHEDULE): Player[] => schedule.map((player) => ({
  id: player.id,
  name: player.name,
  number: 0,
  primaryPosition: '',
  secondaryPosition: '',
  positionGroup: 'SQUAD',
  active: true,
}));

export const buildDefaultPlayers = (): Player[] => buildDefaultPlayersFromSchedule();

export const createEmptyRotation = (players: Player[]): PlannedRotation => {
  return players.reduce((acc, player) => {
    acc[player.id] = Array.from({ length: QUARTER_MINUTES * quarterOrder.length }, () => false);
    return acc;
  }, {} as PlannedRotation);
};

export const initialisePlanForSchedule = (players: Player[], schedule: ScheduleEntry[] = KAMPONG_BLOE_SCHEDULE): PlannedRotation => {
  const rotation = createEmptyRotation(players);
  players.forEach((player) => {
    const imported = schedule.find((entry) => entry.id === player.id);
    if (!imported) return;
    rotation[player.id] = [...imported.q13, ...imported.q24, ...imported.q13, ...imported.q24].map((value) => Boolean(value));
  });

  return rotation;
};

export const initialisePlan = (players: Player[]): PlannedRotation => initialisePlanForSchedule(players);

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

const isGoalkeeper = (player: Player): boolean => {
  const roleText = [player.primaryPosition, player.secondaryPosition, player.positionGroup]
    .join(' ')
    .toLowerCase();

  return roleText.includes('gk') || roleText.includes('goalkeeper') || roleText.includes('keeper');
};

export const getPlayerIntel = (players: Player[], rotation: PlannedRotation, slotIndex: number) => {
  return players.map((player) => {
    const cells = rotation[player.id] ?? Array.from({ length: 60 }, () => false);
    const isOn = cells[slotIndex] ?? false;
    const totalMinutes = cells.slice(0, slotIndex).filter(Boolean).length;

    let currentShiftMinutes = 0;
    if (isOn) {
      for (let index = slotIndex - 1; index >= 0; index -= 1) {
        if (cells[index]) currentShiftMinutes += 1;
        else break;
      }
    }

    let restMinutes = 0;
    if (!isOn) {
      for (let index = slotIndex - 1; index >= 0; index -= 1) {
        if (!cells[index]) restMinutes += 1;
        else break;
      }
    }

    let risk: 'fresh' | 'watch' | 'at-risk' = 'fresh';
    const goalkeeper = isGoalkeeper(player);
    if (goalkeeper) {
      risk = 'fresh';
    } else if (currentShiftMinutes >= 7 || totalMinutes >= 30) {
      risk = 'at-risk';
    } else if (currentShiftMinutes >= 4 || totalMinutes >= 18) {
      risk = 'watch';
    }

    return {
      playerId: player.id,
      name: player.name,
      positionGroup: player.positionGroup,
      isOn,
      totalMinutes,
      currentShiftMinutes,
      restMinutes,
      risk,
      goalkeeper,
    };
  });
};

export const getSecondsUntilSubstitution = (state: MatchState, item: PendingSubstitution): number => {
  const eventElapsed = quarterOrder.indexOf(item.quarter) * QUARTER_LENGTH_SECONDS + (item.minute - 1) * 60;
  const currentElapsed = quarterOrder.indexOf(state.quarter) * QUARTER_LENGTH_SECONDS + (QUARTER_LENGTH_SECONDS - state.clockSeconds);
  return eventElapsed - currentElapsed;
};

export const getUpcomingSubstitutions = (state: MatchState): PendingSubstitution[] => {
  const visible: PendingSubstitution[] = [];
  const currentMatchElapsed = (quarterOrder.indexOf(state.quarter) * QUARTER_MINUTES * 60) + (QUARTER_LENGTH_SECONDS - state.clockSeconds);
  const overrides = new Map(state.pendingQueue.map((item) => [item.id, item]));

  for (let slot = 1; slot < QUARTER_MINUTES * quarterOrder.length; slot += 1) {
    const minute = (slot % QUARTER_MINUTES) + 1;
    const quarter = quarterOrder[Math.floor(slot / QUARTER_MINUTES)];
    const outgoing = state.players.filter((player) => state.plannedRotation[player.id]?.[slot - 1] && !state.plannedRotation[player.id]?.[slot]);
    const incoming = state.players.filter((player) => !state.plannedRotation[player.id]?.[slot - 1] && state.plannedRotation[player.id]?.[slot]);

    outgoing.forEach((player, index) => {
      const replacement = incoming[index];
      if (!replacement) return;
      const id = `${player.id}-${slot}`;
      const entry = overrides.get(id) ?? {
        id,
        quarter,
        minute,
        playerOutId: player.id,
        playerInId: replacement.id,
        status: 'queued' as const,
      };
      if (entry.status === 'cancelled' || entry.status === 'confirmed') return;
      const eventElapsed = quarterOrder.indexOf(entry.quarter) * QUARTER_MINUTES * 60 + (entry.minute - 1) * 60;
      if (currentMatchElapsed < eventElapsed + 60) visible.push(entry);
    });
  }

  return visible
    .sort((left, right) =>
      (quarterOrder.indexOf(left.quarter) * QUARTER_MINUTES + left.minute) -
      (quarterOrder.indexOf(right.quarter) * QUARTER_MINUTES + right.minute))
    .slice(0, 5);
};

// Keep the outgoing player on and the incoming player off in the live lineup
// while a planned substitution is delayed or cancelled. The printable plan is
// never changed by a live-game decision.
export const deferPlannedSubstitution = (
  state: MatchState,
  item: PendingSubstitution,
  untilSlot?: number,
): MatchState => {
  const next = cloneState(state);
  const originalSlot = Number(item.id.slice(item.id.lastIndexOf('-') + 1));
  if (!Number.isInteger(originalSlot) || originalSlot < 0 || originalSlot >= 60) return state;
  const currentSlot = getQuarterMinute(state).slotIndex;
  const quarterEnd = (Math.floor(originalSlot / QUARTER_MINUTES) + 1) * QUARTER_MINUTES;
  let endSlot = Math.min(untilSlot ?? quarterEnd, quarterEnd);
  if (untilSlot === undefined) {
    for (let slot = originalSlot + 1; slot < quarterEnd; slot += 1) {
      const outChanges = next.plannedRotation[item.playerOutId]?.[slot] !== next.plannedRotation[item.playerOutId]?.[slot - 1];
      const inChanges = next.plannedRotation[item.playerInId]?.[slot] !== next.plannedRotation[item.playerInId]?.[slot - 1];
      if (outChanges || inChanges) {
        endSlot = slot;
        break;
      }
    }
  }
  for (let slot = Math.max(originalSlot, currentSlot); slot < endSlot; slot += 1) {
    next.actualRotation[item.playerOutId][slot] = true;
    next.actualRotation[item.playerInId][slot] = false;
  }
  return next;
};

export const applyManualSubstitution = (state: MatchState, playerOutId: string, playerInId: string): MatchState => {
  if (playerOutId === playerInId) return state;
  const next = cloneState(state);
  const playerOut = next.players.find((player) => player.id === playerOutId);
  const playerIn = next.players.find((player) => player.id === playerInId);
  if (!playerOut || !playerIn) return state;

  const { slotIndex } = getQuarterMinute(next);
  if (!next.actualRotation[playerOutId]?.[slotIndex] || next.actualRotation[playerInId]?.[slotIndex]) return state;

  const quarterEnd = (Math.floor(slotIndex / QUARTER_MINUTES) + 1) * QUARTER_MINUTES;
  let endSlot = quarterEnd;
  for (let slot = slotIndex + 1; slot < quarterEnd; slot += 1) {
    const outChanges = next.plannedRotation[playerOutId]?.[slot] !== next.plannedRotation[playerOutId]?.[slot - 1];
    const inChanges = next.plannedRotation[playerInId]?.[slot] !== next.plannedRotation[playerInId]?.[slot - 1];
    if (outChanges || inChanges) {
      endSlot = slot;
      break;
    }
  }
  for (let slot = slotIndex; slot < endSlot; slot += 1) {
    next.actualRotation[playerOutId][slot] = false;
    next.actualRotation[playerInId][slot] = true;
  }

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
