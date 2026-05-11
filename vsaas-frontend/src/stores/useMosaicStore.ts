import { create } from 'zustand';

interface MosaicState {
  pausedSlots: Record<number, boolean>;
  mutedSlots: Record<number, boolean>;
  playbackOffsets: Record<string, number>; // by cameraId
  
  focusedSlot: number | null;
  expandedSlot: number | null;
  overSlot: number | null;
  dragSource: { kind: 'slot'; slotIndex: number } | { kind: 'library'; cameraId: string } | null;
  isWindowVisible: boolean;

  setFocusedSlot: (slot: number | null) => void;
  setExpandedSlot: (slot: number | null) => void;
  setOverSlot: (slot: number | null) => void;
  setDragSource: (src: { kind: 'slot'; slotIndex: number } | { kind: 'library'; cameraId: string } | null) => void;
  setIsWindowVisible: (v: boolean) => void;

  togglePause: (slotIndex: number) => void;
  setPaused: (slotIndex: number, paused: boolean) => void;
  
  toggleMute: (slotIndex: number) => void;
  setMuted: (slotIndex: number, muted: boolean) => void;
  
  setPlaybackOffset: (cameraId: string, offset: number) => void;
  clearPlaybackOffset: (cameraId: string) => void;
}

export const useMosaicStore = create<MosaicState>((set) => ({
  pausedSlots: {},
  mutedSlots: {},
  playbackOffsets: {},
  focusedSlot: null,
  expandedSlot: null,
  overSlot: null,
  dragSource: null,
  isWindowVisible: true,

  setFocusedSlot: (slot) => set({ focusedSlot: slot }),
  setExpandedSlot: (slot) => set({ expandedSlot: slot }),
  setOverSlot: (slot) => set({ overSlot: slot }),
  setDragSource: (src) => set({ dragSource: src }),
  setIsWindowVisible: (v) => set({ isWindowVisible: v }),

  togglePause: (slotIndex) => set((state) => ({
    pausedSlots: {
      ...state.pausedSlots,
      [slotIndex]: !state.pausedSlots[slotIndex]
    }
  })),

  setPaused: (slotIndex, paused) => set((state) => ({
    pausedSlots: {
      ...state.pausedSlots,
      [slotIndex]: paused
    }
  })),

  toggleMute: (slotIndex) => set((state) => ({
    mutedSlots: {
      ...state.mutedSlots,
      [slotIndex]: !state.mutedSlots[slotIndex]
    }
  })),

  setMuted: (slotIndex, muted) => set((state) => ({
    mutedSlots: {
      ...state.mutedSlots,
      [slotIndex]: muted
    }
  })),

  setPlaybackOffset: (cameraId, offset) => set((state) => ({
    playbackOffsets: {
      ...state.playbackOffsets,
      [cameraId]: offset
    }
  })),

  clearPlaybackOffset: (cameraId) => set((state) => {
    const next = { ...state.playbackOffsets };
    delete next[cameraId];
    return { playbackOffsets: next };
  })
}));
