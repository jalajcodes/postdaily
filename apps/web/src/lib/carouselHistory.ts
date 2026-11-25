import type { CarouselDesign, CarouselSlide } from "@postdaily/shared";

export interface HistoryState {
  slides: CarouselSlide[];
  design: CarouselDesign;
  title: string;
}

export class UndoRedo {
  private past: HistoryState[] = [];
  private future: HistoryState[] = [];
  private maxStates = 50;

  /** Record the state as it was BEFORE a change. */
  push(state: HistoryState) {
    const last = this.past[this.past.length - 1];
    if (last && last.slides === state.slides && last.design === state.design && last.title === state.title) return;
    this.past.push(state);
    if (this.past.length > this.maxStates) this.past.shift();
    this.future = [];
  }

  /** Step back; `current` is what's on screen now (kept so redo can return to it). */
  undo(current: HistoryState): HistoryState | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(current);
    return prev;
  }

  redo(current: HistoryState): HistoryState | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    return next;
  }

  canUndo() {
    return this.past.length > 0;
  }

  canRedo() {
    return this.future.length > 0;
  }

  reset() {
    this.past = [];
    this.future = [];
  }
}
