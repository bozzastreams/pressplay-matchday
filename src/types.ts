export type Quarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';

export interface Player {
  id: string;
  name: string;
  number: number;
  primaryPosition: string;
  secondaryPosition: string;
  positionGroup: string;
  active: boolean;
}

export type PlannedRotation = Record<string, boolean[]>;

export interface PendingSubstitution {
  id: string;
  quarter: Quarter;
  minute: number;
  playerOutId: string;
  playerInId: string;
  status: 'queued' | 'called' | 'confirmed' | 'cancelled';
}

export interface SubstitutionEvent {
  id: string;
  quarter: Quarter;
  minute: number;
  playerOutId?: string;
  playerInId?: string;
  reason: string;
  timestamp: number;
}

export interface PlayerStatus {
  playerId: string;
  on: boolean;
  currentShiftSeconds: number;
  totalMinutes: number;
  restSeconds: number;
  shifts: number;
  lastSubstitution: number | null;
  nextPlanned: string | null;
  plannedMinutes: number;
  actualMinutes: number;
}

export interface MatchState {
  matchTitle?: string;
  opponent?: string;
  matchDate?: string;
  venue?: string;
  scoreHome: number;
  scoreAway: number;
  quarter: Quarter;
  clockSeconds: number;
  isRunning: boolean;
  players: Player[];
  plannedRotation: PlannedRotation;
  actualRotation: PlannedRotation;
  viewMode: 'planned' | 'actual';
  eventHistory: SubstitutionEvent[];
  pendingQueue: PendingSubstitution[];
  selectedPlayerId: string | null;
  undoStack: MatchState[];
}

export interface MatchMinuteSummary {
  slotIndex: number;
  quarter: Quarter;
  minute: number;
  onCount: number;
  hasError: boolean;
}
