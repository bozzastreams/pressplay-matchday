import type { MatchState } from '../types';

const STORAGE_KEY = 'pressplay-matchday-state-v2';

export const saveMatchState = (state: MatchState): void => {
  const serializable = {
    ...state,
    undoStack: [],
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
};

export const loadMatchState = (): MatchState | null => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as MatchState;
    return {
      ...parsed,
      undoStack: [],
    };
  } catch {
    return null;
  }
};

export const clearMatchState = (): void => {
  window.localStorage.removeItem(STORAGE_KEY);
};
