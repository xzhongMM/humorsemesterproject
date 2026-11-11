"use client";

import { HeartIcon as HeartOutlineIcon } from "@heroicons/react/24/outline";
import { HeartIcon as HeartSolidIcon } from "@heroicons/react/24/solid";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  endStudy,
  saveStudyProgress,
  startStudy,
} from "@/app/study/actions";
import type { StudyParticipation } from "@/lib/study-participation";
import type { StudyStats } from "@/lib/study-stats";
import { CompletedStudy } from "@/components/CompletedStudy";
import { STUDY_CAPTION_BATCH_SIZE } from "@/lib/study-caption-order";

import {
  loadMoreCaptionVoteCaptions,
  removeCaptionVote,
  saveCaptionNavigationEvent,
  saveCaptionVote,
} from "@/app/actions";
import {
  HEART_VOTE_VALUE,
  type VoteInputMethod,
} from "@/lib/caption-votes";

import { SwipeVoteCard } from "./SwipeVoteCard";

export type CaptionForVote = {
  id: string;
  isLiked: boolean;
  isSaved: boolean;
  content: string | null;
  imageSrc: string | null;
  studyCaptionMappingId: number | null;
};

const VOTE_SESSION_STORAGE_KEY = "captionVoteSessionId";
const LIKE_ADVANCE_COOLDOWN_MS = 400;
const DEFAULT_VOTE_BAR_GUTTER_PX = 116;
const BASE_SCREEN_BOTTOM_PADDING_PX = 24;
const STANDALONE_PROGRESS_GUTTER_PX = 34;
const VOTE_BAR_PROGRESS_GUTTER_PX = 22;
const TOUCH_NAVIGATION_THRESHOLD_PX = 52;
const WHEEL_NAVIGATION_THRESHOLD_PX = 32;
const WHEEL_GESTURE_IDLE_MS = 110;
const HEART_BURST_CLEAR_MS = 980;
const HEART_BURST_PARTICLES = [
  {
    x: -76,
    y: -22,
    delayMs: 0,
    sizePx: 8,
    durationMs: 720,
    rotateDeg: -14,
    stretch: 2.8,
  },
  {
    x: -64,
    y: -54,
    delayMs: 18,
    sizePx: 7,
    durationMs: 760,
    rotateDeg: -34,
    stretch: 2.4,
  },
  {
    x: -44,
    y: -86,
    delayMs: 0,
    sizePx: 7,
    durationMs: 780,
    rotateDeg: -70,
    stretch: 2.9,
  },
  {
    x: -12,
    y: -102,
    delayMs: 36,
    sizePx: 8,
    durationMs: 820,
    rotateDeg: -88,
    stretch: 3.2,
  },
  {
    x: 24,
    y: -84,
    delayMs: 28,
    sizePx: 6,
    durationMs: 700,
    rotateDeg: -58,
    stretch: 2.2,
  },
  {
    x: 38,
    y: -56,
    delayMs: 56,
    sizePx: 5,
    durationMs: 640,
    rotateDeg: -28,
    stretch: 1.9,
  },
  {
    x: -88,
    y: 4,
    delayMs: 42,
    sizePx: 7,
    durationMs: 700,
    rotateDeg: 0,
    stretch: 2.7,
  },
  {
    x: -74,
    y: 34,
    delayMs: 84,
    sizePx: 6,
    durationMs: 660,
    rotateDeg: 22,
    stretch: 2.2,
  },
  {
    x: -46,
    y: 56,
    delayMs: 110,
    sizePx: 6,
    durationMs: 620,
    rotateDeg: 48,
    stretch: 2.1,
  },
  {
    x: -14,
    y: 68,
    delayMs: 120,
    sizePx: 5,
    durationMs: 580,
    rotateDeg: 78,
    stretch: 1.8,
  },
  {
    x: 16,
    y: 34,
    delayMs: 96,
    sizePx: 4,
    durationMs: 540,
    rotateDeg: 54,
    stretch: 1.6,
  },
  {
    x: 28,
    y: 2,
    delayMs: 70,
    sizePx: 4,
    durationMs: 500,
    rotateDeg: 12,
    stretch: 1.5,
  },
] as const;

type VoteEventDetails = {
  clientEventId: string;
  inputMethod: VoteInputMethod;
  sessionId: string;
  timeToVoteMs: number;
};

type NavigationEventDetails = {
  clientEventId: string;
  inputMethod: VoteInputMethod;
  sessionId: string;
  timeToNextCaptionMs: number;
};

type TouchGestureState = {
  active: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
};

type VoteStatus = "removing" | "saving" | "saved";
type HeartBurstState = {
  token: number;
  voteKey: string | null;
};
type SessionStudyStatsState = {
  likedCaptionTimeMsByKey: Record<string, number>;
  navigationTimeMsByKey: Record<string, number>;
  viewedCaptionKeys: Record<string, true>;
};
type CaptionFlipDirection = "backward" | "forward";

function createEmptySessionStudyStats(): SessionStudyStatsState {
  return {
    likedCaptionTimeMsByKey: {},
    navigationTimeMsByKey: {},
    viewedCaptionKeys: {},
  };
}

function getMedianValue(values: number[]) {
  if (!values.length) {
    return null;
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sortedValues.length / 2);

  if (sortedValues.length % 2 === 1) {
    return sortedValues[middleIndex];
  }

  return Math.round(
    (sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2
  );
}

function summarizeCompletionStats(
  sessionStudyStats: SessionStudyStatsState,
  viewedCountFloor = 0
): StudyStats {
  const viewedCount = Math.max(
    viewedCountFloor,
    Object.keys(sessionStudyStats.viewedCaptionKeys).length
  );
  const likedCount = Object.keys(sessionStudyStats.likedCaptionTimeMsByKey).length;
  const medianVoteTimeMs = getMedianValue(
    Object.values(sessionStudyStats.likedCaptionTimeMsByKey)
  );
  const medianNavigationTimeMs = getMedianValue(
    Object.values(sessionStudyStats.navigationTimeMsByKey)
  );

  return {
    likedCount,
    medianNavigationTimeMs,
    medianVoteTimeMs,
    viewedCount,
  };
}

function getNowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function normalizeWheelDeltaY(event: WheelEvent) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * 16;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * (window.innerHeight || 1);
  }

  return event.deltaY;
}

function isCaptionTimerActive() {
  if (typeof document === "undefined") {
    return false;
  }

  return document.visibilityState === "visible" && document.hasFocus();
}

function createClientUuid() {
  const cryptoApi = globalThis.crypto;

  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }

  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
      12,
      16
    )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function getCaptionVoteKey(caption: CaptionForVote | undefined) {
  if (!caption) {
    return null;
  }

  if (
    typeof caption.studyCaptionMappingId === "number" &&
    Number.isSafeInteger(caption.studyCaptionMappingId) &&
    caption.studyCaptionMappingId > 0
  ) {
    return `mapping:${caption.studyCaptionMappingId}`;
  }

  return `caption:${caption.id}`;
}

function createPersistedVoteStatusLookup(captions: readonly CaptionForVote[]) {
  return captions.reduce<Record<string, VoteStatus>>((lookup, caption) => {
    if (!caption.isLiked) {
      return lookup;
    }

    const voteKey = getCaptionVoteKey(caption);

    if (voteKey) {
      lookup[voteKey] = "saved";
    }

    return lookup;
  }, {});
}

function shouldIgnoreKeyboardNavigationTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], [data-native-scroll-region='true']"
    )
  );
}

function shouldIgnoreWheelNavigationTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], #account-menu-root, #theme-menu-root, [data-native-scroll-region='true']"
    )
  );
}

function shouldIgnoreTouchNavigationTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], #account-menu-root, #theme-menu-root, [data-native-scroll-region='true']"
    )
  );
}

export function CaptionVoteFlow({
  captionOrder,
  captions,
  includePrivateStudies,
  initialStartOffset,
  initialNextOffset,
  initialTotalCaptionCount,
  initialParticipation,
  reservedTopPx = 0,
  studyId,
  onPendingChange,
}: {
  captionOrder: string[];
  captions: CaptionForVote[];
  includePrivateStudies?: boolean;
  initialStartOffset: number;
  initialNextOffset: number | null;
  initialTotalCaptionCount: number;
  initialParticipation: StudyParticipation | null;
  reservedTopPx?: number;
  studyId?: number | null;
  onPendingChange?: (count: number) => void;
}) {
  const [voteBarGutterPx, setVoteBarGutterPx] = useState(
    DEFAULT_VOTE_BAR_GUTTER_PX
  );
  const [isStartPageVisible, setIsStartPageVisible] = useState(
    captions.length > 0
  );
  const [queue, setQueue] = useState(captions);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [queueStartOffset, setQueueStartOffset] = useState(initialStartOffset);
  const [isShortViewport, setIsShortViewport] = useState(false);
  const [isLoadingMoreCaptions, setIsLoadingMoreCaptions] = useState(false);
  const [nextCaptionOffset, setNextCaptionOffset] = useState(initialNextOffset);
  const [pendingCount, setPendingCount] = useState(0);
  const [participation, setParticipation] = useState(initialParticipation);
  const [participationPending, setParticipationPending] = useState(false);
  const participationPendingRef = useRef(false);
  const progressSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const lastLikeAdvanceAtMsRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [captionFlipDirection, setCaptionFlipDirection] =
    useState<CaptionFlipDirection>("forward");
  const [isWheelNavigationOverlayVisible, setIsWheelNavigationOverlayVisible] =
    useState(false);
  const [heartBurst, setHeartBurst] = useState<HeartBurstState>({
    token: 0,
    voteKey: null,
  });
  const [isCompletionPageVisible, setIsCompletionPageVisible] = useState(false);
  const [sessionStudyStats, setSessionStudyStats] =
    useState<SessionStudyStatsState>(() => createEmptySessionStudyStats());
  const [voteStatuses, setVoteStatuses] = useState<Record<string, VoteStatus>>(
    () => createPersistedVoteStatusLookup(captions)
  );
  const activeVoteTimeMs = useRef(0);
  const activeVoteStartedAtMs = useRef<number | null>(
    isCaptionTimerActive() ? getNowMs() : null
  );
  const activeNavigationTimeMs = useRef(0);
  const activeNavigationStartedAtMs = useRef<number | null>(
    isCaptionTimerActive() ? getNowMs() : null
  );
  const currentIndexRef = useRef(0);
  const touchGestureRef = useRef<TouchGestureState>({
    active: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
  });
  const voteSessionIdRef = useRef<string | null>(null);
  const wheelGestureRef = useRef<{
    accumulatedY: number;
    isLocked: boolean;
    lastEventTimeMs: number;
  }>({
    accumulatedY: 0,
    isLocked: false,
    lastEventTimeMs: 0,
  });
  const heartBurstTimeoutIdRef = useRef<number | null>(null);
  const requestedCaptionOffsetsRef = useRef<Set<number>>(new Set());
  const wheelNavigationOverlayTimeoutIdRef = useRef<number | null>(null);
  const wheelNavigationOverlayVisibleRef = useRef(false);

  useEffect(() => {
    onPendingChange?.(pendingCount);
  }, [onPendingChange, pendingCount]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    wheelNavigationOverlayVisibleRef.current = isWheelNavigationOverlayVisible;
  }, [isWheelNavigationOverlayVisible]);

  useEffect(() => {
    const maxIndex = Math.max(0, queue.length - 1);

    setCurrentIndex((previousIndex) => {
      const clampedIndex = Math.min(previousIndex, maxIndex);
      currentIndexRef.current = clampedIndex;
      return clampedIndex;
    });
  }, [queue.length]);

  useEffect(() => {
    setQueue(captions);
    setVoteStatuses(createPersistedVoteStatusLookup(captions));
    setIsCompletionPageVisible(false);
    setCurrentIndex(0);
    currentIndexRef.current = 0;
    setQueueStartOffset(initialStartOffset);
    setNextCaptionOffset(initialNextOffset);
    requestedCaptionOffsetsRef.current.clear();
  }, [captions, initialNextOffset, initialStartOffset]);

  useEffect(() => {
    return () => {
      if (wheelNavigationOverlayTimeoutIdRef.current !== null) {
        window.clearTimeout(wheelNavigationOverlayTimeoutIdRef.current);
      }

      if (heartBurstTimeoutIdRef.current !== null) {
        window.clearTimeout(heartBurstTimeoutIdRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(pointer: coarse)");

    const updateGutter = () => {
      const height = window.visualViewport?.height ?? window.innerHeight ?? 0;
      const isCoarse = mediaQuery.matches;

      let next: number;

      if (isCoarse) {
        if (height < 430) {
          next = 94;
        } else if (height < 520) {
          next = 102;
        } else if (height < 680) {
          next = 110;
        } else {
          next = 116;
        }
      } else if (height < 540) {
        next = 82;
      } else if (height < 720) {
        next = 90;
      } else {
        next = 98;
      }

      const minGutter = isCoarse ? 88 : 76;
      const maxGutter = isCoarse ? 132 : 112;

      setVoteBarGutterPx(Math.min(maxGutter, Math.max(minGutter, next)));
      setIsShortViewport(height < 620);
    };

    updateGutter();
    window.addEventListener("resize", updateGutter);
    window.addEventListener("orientationchange", updateGutter);

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", updateGutter);
    } else {
      mediaQuery.addListener(updateGutter);
    }

    return () => {
      window.removeEventListener("resize", updateGutter);
      window.removeEventListener("orientationchange", updateGutter);

      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", updateGutter);
      } else {
        mediaQuery.removeListener(updateGutter);
      }
    };
  }, []);

  const current = queue[currentIndex];
  const currentVoteKey = getCaptionVoteKey(current);
  const currentVoteStatus = currentVoteKey ? voteStatuses[currentVoteKey] : null;
  const isCurrentVoteSaving = currentVoteStatus === "saving";
  const isCurrentVoteRemoving = currentVoteStatus === "removing";
  const hasCurrentSavedVote =
    currentVoteStatus === "saved" ||
    currentVoteStatus === "saving" ||
    currentVoteStatus === "removing";
  const isShowingCompletionPage =
    !isStartPageVisible && (queue.length === 0 || isCompletionPageVisible);
  const shouldShowInlineCaptionActions = Boolean(current?.imageSrc);
  const shouldShowVoteBar =
    !isStartPageVisible &&
    !shouldShowInlineCaptionActions &&
    !isShowingCompletionPage;
  const totalCaptionCount = Math.max(initialTotalCaptionCount, queue.length);
  const currentCaptionNumber =
    current && totalCaptionCount > 0
      ? Math.min(totalCaptionCount, queueStartOffset + currentIndex + 1)
      : null;
  const captionProgressLabel =
    currentCaptionNumber && totalCaptionCount > 0
      ? `${currentCaptionNumber.toLocaleString("en-US")}/${totalCaptionCount.toLocaleString("en-US")}`
      : null;
  const shouldShowCaptionProgress =
    Boolean(captionProgressLabel) &&
    !isStartPageVisible &&
    !isShowingCompletionPage;
  const reservedBottomPx = shouldShowVoteBar
    ? voteBarGutterPx + VOTE_BAR_PROGRESS_GUTTER_PX
    : 0;
  const standaloneProgressPaddingPx =
    shouldShowCaptionProgress && !shouldShowVoteBar
      ? STANDALONE_PROGRESS_GUTTER_PX
      : 0;
  const contentBottomPaddingPx =
    reservedBottomPx + BASE_SCREEN_BOTTOM_PADDING_PX + standaloneProgressPaddingPx;
  const preloadImageUrls = queue
    .slice(currentIndex + 1, currentIndex + 6)
    .map((caption) => caption.imageSrc)
    .filter((url): url is string => Boolean(url));

  const getVoteSessionId = useCallback(() => {
    if (voteSessionIdRef.current) {
      return voteSessionIdRef.current;
    }

    const nextSessionId = createClientUuid();

    try {
      const existingSessionId = window.sessionStorage.getItem(
        VOTE_SESSION_STORAGE_KEY
      );

      if (existingSessionId) {
        voteSessionIdRef.current = existingSessionId;
        return existingSessionId;
      }

      window.sessionStorage.setItem(VOTE_SESSION_STORAGE_KEY, nextSessionId);
    } catch {
      // Storage access can fail in restricted browser contexts; fall back to memory.
    }

    voteSessionIdRef.current = nextSessionId;
    return nextSessionId;
  }, []);

  const pauseVoteTimer = useCallback(() => {
    if (activeVoteStartedAtMs.current === null) {
      return;
    }

    activeVoteTimeMs.current += Math.max(
      0,
      getNowMs() - activeVoteStartedAtMs.current
    );
    activeVoteStartedAtMs.current = null;
  }, []);

  const resumeVoteTimer = useCallback(() => {
    if (activeVoteStartedAtMs.current !== null) {
      return;
    }

    activeVoteStartedAtMs.current = getNowMs();
  }, []);

  const syncVoteTimer = useCallback(() => {
    if (isStartPageVisible || currentVoteStatus || isShowingCompletionPage) {
      pauseVoteTimer();
      return;
    }

    if (isCaptionTimerActive()) {
      resumeVoteTimer();
      return;
    }

    pauseVoteTimer();
  }, [
    isStartPageVisible,
    isShowingCompletionPage,
    currentVoteStatus,
    pauseVoteTimer,
    resumeVoteTimer,
  ]);

  const resetVoteTimer = useCallback(() => {
    activeVoteTimeMs.current = 0;
    activeVoteStartedAtMs.current = isCaptionTimerActive() ? getNowMs() : null;
  }, []);

  const getActiveVoteTimeMs = useCallback(() => {
    const activeSegmentMs =
      activeVoteStartedAtMs.current === null
        ? 0
        : Math.max(0, getNowMs() - activeVoteStartedAtMs.current);

    return Math.max(0, Math.round(activeVoteTimeMs.current + activeSegmentMs));
  }, []);

  const createVoteEventDetails = useCallback(
    (inputMethod: VoteInputMethod): VoteEventDetails => ({
      clientEventId: createClientUuid(),
      inputMethod,
      sessionId: getVoteSessionId(),
      timeToVoteMs: getActiveVoteTimeMs(),
    }),
    [getActiveVoteTimeMs, getVoteSessionId]
  );

  const pauseNavigationTimer = useCallback(() => {
    if (activeNavigationStartedAtMs.current === null) {
      return;
    }

    activeNavigationTimeMs.current += Math.max(
      0,
      getNowMs() - activeNavigationStartedAtMs.current
    );
    activeNavigationStartedAtMs.current = null;
  }, []);

  const resumeNavigationTimer = useCallback(() => {
    if (activeNavigationStartedAtMs.current !== null) {
      return;
    }

    activeNavigationStartedAtMs.current = getNowMs();
  }, []);

  const syncNavigationTimer = useCallback(() => {
    if (isStartPageVisible || isShowingCompletionPage) {
      pauseNavigationTimer();
      return;
    }

    if (isCaptionTimerActive()) {
      resumeNavigationTimer();
      return;
    }

    pauseNavigationTimer();
  }, [
    isStartPageVisible,
    isShowingCompletionPage,
    pauseNavigationTimer,
    resumeNavigationTimer,
  ]);

  const resetNavigationTimer = useCallback(() => {
    activeNavigationTimeMs.current = 0;
    activeNavigationStartedAtMs.current = isCaptionTimerActive()
      ? getNowMs()
      : null;
  }, []);

  const getActiveNavigationTimeMs = useCallback(() => {
    const activeSegmentMs =
      activeNavigationStartedAtMs.current === null
        ? 0
        : Math.max(0, getNowMs() - activeNavigationStartedAtMs.current);

    return Math.max(
      0,
      Math.round(activeNavigationTimeMs.current + activeSegmentMs)
    );
  }, []);

  const createNavigationEventDetails = useCallback(
    (inputMethod: VoteInputMethod): NavigationEventDetails => ({
      clientEventId: createClientUuid(),
      inputMethod,
      sessionId: getVoteSessionId(),
      timeToNextCaptionMs: getActiveNavigationTimeMs(),
    }),
    [getActiveNavigationTimeMs, getVoteSessionId]
  );

  const setVoteStatus = useCallback(
    (voteKey: string | null, status: VoteStatus | null) => {
      if (!voteKey) {
        return;
      }

      setVoteStatuses((prev) => {
        if (status === null) {
          const next = { ...prev };
          delete next[voteKey];
          return next;
        }

        return {
          ...prev,
          [voteKey]: status,
        };
      });
    },
    []
  );

  const triggerHeartBurst = useCallback((voteKey: string | null) => {
    if (!voteKey) {
      return;
    }

    setHeartBurst((previousBurst) => ({
      token: previousBurst.token + 1,
      voteKey,
    }));

    if (heartBurstTimeoutIdRef.current !== null) {
      window.clearTimeout(heartBurstTimeoutIdRef.current);
    }

    heartBurstTimeoutIdRef.current = window.setTimeout(() => {
      setHeartBurst((previousBurst) =>
        previousBurst.voteKey === voteKey
          ? {
              ...previousBurst,
              voteKey: null,
            }
          : previousBurst
      );
      heartBurstTimeoutIdRef.current = null;
    }, HEART_BURST_CLEAR_MS);
  }, []);

  const appendCaptionBatch = useCallback((incomingCaptions: CaptionForVote[]) => {
    if (!incomingCaptions.length) {
      return;
    }

    const appendedCaptions: CaptionForVote[] = [];

    setQueue((previousQueue) => {
      const seenVoteKeys = new Set(
        previousQueue
          .map((caption) => getCaptionVoteKey(caption))
          .filter((voteKey): voteKey is string => Boolean(voteKey))
      );
      const nextQueue = [...previousQueue];

      incomingCaptions.forEach((caption) => {
        const voteKey = getCaptionVoteKey(caption);

        if (!voteKey || seenVoteKeys.has(voteKey)) {
          return;
        }

        seenVoteKeys.add(voteKey);
        nextQueue.push(caption);
        appendedCaptions.push(caption);
      });

      return nextQueue;
    });

    if (appendedCaptions.length) {
      setVoteStatuses((previousVoteStatuses) => {
        const nextVoteStatuses = { ...previousVoteStatuses };

        appendedCaptions.forEach((caption) => {
          if (!caption.isLiked) {
            return;
          }

          const voteKey = getCaptionVoteKey(caption);

          if (voteKey) {
            nextVoteStatuses[voteKey] = "saved";
          }
        });

        return nextVoteStatuses;
      });
    }
  }, []);

  const saveProgressAtIndex = useCallback(
    (captionIndex: number) => {
      if (!studyId) {
        return;
      }

      const progressSave = progressSaveChainRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            const result = await saveStudyProgress(studyId, captionIndex);
            if (!result.success) {
              console.error("[CaptionVoteFlow] save study progress failed", result.error);
              setError(result.error);
              return;
            }

            setError((currentError) =>
              currentError ===
              "We couldn't save your latest study progress. Please try again."
                ? null
                : currentError
            );
          } catch (err) {
            console.error("[CaptionVoteFlow] save study progress failed", err);
            setError(
              "We couldn't save your latest study progress. Please try again."
            );
          }
        });

      progressSaveChainRef.current = progressSave;
    },
    [studyId]
  );

  const loadMoreCaptions = useCallback(
    async (offset: number) => {
      if (
        isLoadingMoreCaptions ||
        requestedCaptionOffsetsRef.current.has(offset)
      ) {
        return;
      }

      requestedCaptionOffsetsRef.current.add(offset);
      setIsLoadingMoreCaptions(true);

      try {
        const captionIds = captionOrder.slice(offset, offset + STUDY_CAPTION_BATCH_SIZE);
        const result = await loadMoreCaptionVoteCaptions({
          captionIds,
          includePrivateStudies,
          studyId,
        });

        if (!result.success) {
          requestedCaptionOffsetsRef.current.delete(offset);
          setError(
            result.error ?? "We couldn't load more captions. Please try again."
          );
          return;
        }

        appendCaptionBatch(result.captions);
        const consumedCount = offset + captionIds.length;
        setNextCaptionOffset(consumedCount < captionOrder.length ? consumedCount : null);
      } catch (err) {
        console.error("[CaptionVoteFlow] load more captions failed", err);
        requestedCaptionOffsetsRef.current.delete(offset);
        setError("We couldn't load more captions. Please try again.");
      } finally {
        setIsLoadingMoreCaptions(false);
      }
    },
    [appendCaptionBatch, captionOrder, includePrivateStudies, isLoadingMoreCaptions, studyId]
  );

  const loadPreviousCaptions = useCallback(
    async (endOffset: number) => {
      const startOffset = Math.max(0, endOffset - STUDY_CAPTION_BATCH_SIZE);
      if (
        startOffset >= endOffset ||
        isLoadingMoreCaptions ||
        requestedCaptionOffsetsRef.current.has(startOffset)
      ) {
        return;
      }

      requestedCaptionOffsetsRef.current.add(startOffset);
      setIsLoadingMoreCaptions(true);

      try {
        const captionIds = captionOrder.slice(startOffset, endOffset);
        const result = await loadMoreCaptionVoteCaptions({
          captionIds,
          includePrivateStudies,
          studyId,
        });

        if (!result.success) {
          requestedCaptionOffsetsRef.current.delete(startOffset);
          setError(
            result.error ?? "We couldn't load earlier captions. Please try again."
          );
          return;
        }

        const incomingCaptions = result.captions;
        if (!incomingCaptions.length) {
          requestedCaptionOffsetsRef.current.delete(startOffset);
          setError("We couldn't find an earlier caption to resume.");
          return;
        }

        setQueue((previousQueue) => [...incomingCaptions, ...previousQueue]);
        setVoteStatuses((previousVoteStatuses) => {
          const nextVoteStatuses = { ...previousVoteStatuses };
          incomingCaptions.forEach((caption) => {
            if (!caption.isLiked) {
              return;
            }

            const voteKey = getCaptionVoteKey(caption);
            if (voteKey) {
              nextVoteStatuses[voteKey] = "saved";
            }
          });
          return nextVoteStatuses;
        });

        const actualStartOffset = endOffset - incomingCaptions.length;
        const previousCaptionIndex = incomingCaptions.length - 1;
        setQueueStartOffset(actualStartOffset);
        currentIndexRef.current = previousCaptionIndex;
        setCurrentIndex(previousCaptionIndex);
        setCaptionFlipDirection("backward");
        saveProgressAtIndex(actualStartOffset + previousCaptionIndex);
      } catch (err) {
        console.error("[CaptionVoteFlow] load previous captions failed", err);
        requestedCaptionOffsetsRef.current.delete(startOffset);
        setError("We couldn't load earlier captions. Please try again.");
      } finally {
        setIsLoadingMoreCaptions(false);
      }
    },
    [
      captionOrder,
      includePrivateStudies,
      isLoadingMoreCaptions,
      saveProgressAtIndex,
      studyId,
    ]
  );

  const moveToCaptionIndex = useCallback(
    (nextIndex: number) => {
      const maxIndex = queue.length - 1;

      if (maxIndex < 0) {
        return false;
      }

      const clampedIndex = Math.min(maxIndex, Math.max(0, nextIndex));

      if (clampedIndex === currentIndexRef.current) {
        return false;
      }

      currentIndexRef.current = clampedIndex;
      setCurrentIndex(clampedIndex);
      return true;
    },
    [queue.length]
  );

  const saveForwardNavigationTelemetry = useCallback(
    (inputMethod: VoteInputMethod) => {
      if (!current) {
        return;
      }

      const navigationTarget = current;
      const navigationVoteKey = getCaptionVoteKey(navigationTarget);
      const eventDetails = createNavigationEventDetails(inputMethod);

      if (navigationVoteKey) {
        setSessionStudyStats((previousStats) => ({
          likedCaptionTimeMsByKey: previousStats.likedCaptionTimeMsByKey,
          navigationTimeMsByKey: {
            ...previousStats.navigationTimeMsByKey,
            [navigationVoteKey]: eventDetails.timeToNextCaptionMs,
          },
          viewedCaptionKeys: {
            ...previousStats.viewedCaptionKeys,
            [navigationVoteKey]: true,
          },
        }));
      }

      void saveCaptionNavigationEvent({
        captionId: navigationTarget.id,
        clientEventId: eventDetails.clientEventId,
        inputMethod: eventDetails.inputMethod,
        sessionId: eventDetails.sessionId,
        studyCaptionMappingId: navigationTarget.studyCaptionMappingId,
        timeToNextCaptionMs: eventDetails.timeToNextCaptionMs,
      })
        .then((result) => {
          if (!result?.success) {
            console.error(
              "[CaptionVoteFlow] save navigation telemetry failed",
              result?.error
            );
          }
        })
        .catch((err) => {
          console.error("[CaptionVoteFlow] save navigation telemetry failed", err);
        });
    },
    [createNavigationEventDetails, current]
  );

  const handleStartStudy = useCallback(async () => {
    if (participationPendingRef.current || !studyId) return;
    participationPendingRef.current = true;
    setParticipationPending(true);
    setError(null);
    try {
      const result = await startStudy(studyId, captionOrder);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setParticipation(result.participation);
      setCaptionFlipDirection("forward");
      setIsStartPageVisible(false);
      setIsCompletionPageVisible(Boolean(result.participation.ended_at));
    } catch {
      setError("We couldn't start this study. Please try again.");
    } finally {
      participationPendingRef.current = false;
      setParticipationPending(false);
    }
  }, [captionOrder, studyId]);

  const handleEndStudy = useCallback(async () => {
    if (
      !isShowingCompletionPage ||
      participationPendingRef.current ||
      pendingCount > 0 ||
      !studyId ||
      participation?.ended_at
    ) return;
    participationPendingRef.current = true;
    setParticipationPending(true);
    setError(null);
    try {
      const result = await endStudy(studyId, summarizeCompletionStats(sessionStudyStats));
      if (!result.success) {
        setError(result.error);
        return;
      }
      setParticipation(result.participation);
    } catch {
      setError("We couldn't end this study. Please try again.");
    } finally {
      participationPendingRef.current = false;
      setParticipationPending(false);
    }
  }, [isShowingCompletionPage, participation?.ended_at, pendingCount, sessionStudyStats, studyId]);

  const navigateToRelativeCaption = useCallback(
    (offset: -1 | 1, inputMethod: VoteInputMethod) => {
      if (
        participationPendingRef.current ||
        isLoadingMoreCaptions ||
        participation?.ended_at
      ) return false;
      if (isStartPageVisible) {
        if (offset === 1 && current) {
          void handleStartStudy();
          return true;
        }

        return false;
      }

      if (isShowingCompletionPage) {
        if (offset === -1 && current) {
          setCaptionFlipDirection("backward");
          setIsCompletionPageVisible(false);
          return true;
        }

        return true;
      }

      const nextIndex = currentIndexRef.current + offset;

      if (offset === -1 && nextIndex < 0 && current) {
        if (queueStartOffset > 0) {
          void loadPreviousCaptions(queueStartOffset);
          return true;
        }

        setCaptionFlipDirection("backward");
        setIsStartPageVisible(true);
        return true;
      }

      if (offset === 1) {
        const maxIndex = queue.length - 1;

        if (maxIndex < 0) {
          setIsCompletionPageVisible(true);
          return true;
        }

        if (nextIndex > maxIndex) {
          if (nextCaptionOffset !== null && !isLoadingMoreCaptions) {
            void loadMoreCaptions(nextCaptionOffset);
            return false;
          }

          if (nextCaptionOffset === null) {
            saveForwardNavigationTelemetry(inputMethod);
            pauseVoteTimer();
            pauseNavigationTimer();
            setIsCompletionPageVisible(true);
            return true;
          }

          return false;
        }

        saveForwardNavigationTelemetry(inputMethod);
      }

      setCaptionFlipDirection(offset === 1 ? "forward" : "backward");
      const moved = moveToCaptionIndex(nextIndex);
      if (moved) {
        saveProgressAtIndex(queueStartOffset + nextIndex);
      }
      return moved;
    },
    [
      current,
      handleStartStudy,
      isLoadingMoreCaptions,
      isShowingCompletionPage,
      isStartPageVisible,
      loadMoreCaptions,
      loadPreviousCaptions,
      moveToCaptionIndex,
      nextCaptionOffset,
      participation?.ended_at,
      pauseNavigationTimer,
      pauseVoteTimer,
      queue.length,
      queueStartOffset,
      saveForwardNavigationTelemetry,
      saveProgressAtIndex,
    ]
  );

  const handleWheelNavigation = useCallback(
    (event: WheelEvent) => {
      const deltaY = normalizeWheelDeltaY(event);

      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        shouldIgnoreWheelNavigationTarget(event.target) ||
        Math.abs(deltaY) < 4 ||
        Math.abs(deltaY) < Math.abs(event.deltaX) ||
        queue.length === 0
      ) {
        return;
      }

      event.preventDefault();

      const wheelGesture = wheelGestureRef.current;
      const nowMs = getNowMs();
      const timeSinceLastEventMs = nowMs - wheelGesture.lastEventTimeMs;

      const scheduleWheelNavigationOverlay = () => {
        if (wheelNavigationOverlayTimeoutIdRef.current !== null) {
          window.clearTimeout(wheelNavigationOverlayTimeoutIdRef.current);
        }

        if (!wheelNavigationOverlayVisibleRef.current) {
          wheelNavigationOverlayVisibleRef.current = true;
          setIsWheelNavigationOverlayVisible(true);
        }

        wheelNavigationOverlayTimeoutIdRef.current = window.setTimeout(() => {
          wheelNavigationOverlayTimeoutIdRef.current = null;
          wheelNavigationOverlayVisibleRef.current = false;
          setIsWheelNavigationOverlayVisible(false);
        }, WHEEL_GESTURE_IDLE_MS);
      };

      if (wheelGesture.isLocked) {
        if (timeSinceLastEventMs > WHEEL_GESTURE_IDLE_MS) {
          wheelGesture.isLocked = false;
          wheelGesture.accumulatedY = 0;
        } else {
          wheelGesture.lastEventTimeMs = nowMs;
          if (wheelNavigationOverlayVisibleRef.current) {
            scheduleWheelNavigationOverlay();
          }
          return;
        }
      } else if (timeSinceLastEventMs > WHEEL_GESTURE_IDLE_MS) {
        wheelGesture.accumulatedY = 0;
      }

      wheelGesture.lastEventTimeMs = nowMs;
      wheelGesture.accumulatedY += deltaY;

      if (Math.abs(wheelGesture.accumulatedY) < WHEEL_NAVIGATION_THRESHOLD_PX) {
        return;
      }

      // Interpret trackpad/mouse-wheel input as scroll direction, not raw finger
      // motion, so the browser/OS scroll preference continues to apply.
      const didHandleNavigation = navigateToRelativeCaption(
        wheelGesture.accumulatedY > 0 ? 1 : -1,
        "swipe"
      );

      if (didHandleNavigation) {
        wheelGesture.isLocked = true;
        wheelGesture.accumulatedY = 0;
        wheelGesture.lastEventTimeMs = nowMs;
        scheduleWheelNavigationOverlay();
      }
    },
    [navigateToRelativeCaption, queue.length]
  );

  const handleTouchStart = useCallback((event: TouchEvent) => {
    if (
      event.defaultPrevented ||
      shouldIgnoreTouchNavigationTarget(event.target) ||
      event.touches.length !== 1
    ) {
      touchGestureRef.current.active = false;
      return;
    }

    const touch = event.touches[0];

    touchGestureRef.current = {
      active: true,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
    };
  }, []);

  const tryNavigateFromTouchGesture = useCallback(
    (endX: number, endY: number) => {
      const touchGesture = touchGestureRef.current;

      if (!touchGesture.active) {
        return false;
      }

      const deltaX = endX - touchGesture.startX;
      const deltaY = endY - touchGesture.startY;

      if (
        Math.abs(deltaY) < TOUCH_NAVIGATION_THRESHOLD_PX ||
        Math.abs(deltaY) < Math.abs(deltaX) * 1.15
      ) {
        return false;
      }

      touchGesture.active = false;
      return navigateToRelativeCaption(deltaY < 0 ? 1 : -1, "swipe");
    },
    [navigateToRelativeCaption]
  );

  const handleTouchMove = useCallback((event: TouchEvent) => {
    if (!touchGestureRef.current.active || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    touchGestureRef.current.lastX = touch.clientX;
    touchGestureRef.current.lastY = touch.clientY;

    tryNavigateFromTouchGesture(touch.clientX, touch.clientY);
  }, [tryNavigateFromTouchGesture]);

  const handleTouchEnd = useCallback(
    (event: TouchEvent) => {
      const touchGesture = touchGestureRef.current;

      if (!touchGesture.active) {
        return;
      }

      const touch = event.changedTouches[0];
      const endX = touch?.clientX ?? touchGesture.lastX;
      const endY = touch?.clientY ?? touchGesture.lastY;

      if (!tryNavigateFromTouchGesture(endX, endY)) {
        touchGesture.active = false;
      }
    },
    [tryNavigateFromTouchGesture]
  );

  const handleTouchCancel = useCallback(() => {
    touchGestureRef.current.active = false;
  }, []);

  const handleKeyboardNavigation = useCallback(
    (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        shouldIgnoreKeyboardNavigationTarget(event.target) ||
        event.repeat
      ) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        navigateToRelativeCaption(1, "keyboard");
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        navigateToRelativeCaption(-1, "keyboard");
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        const heartButton = document.querySelector<HTMLButtonElement>(
          "[data-heart-vote-control]:not(:disabled)"
        );
        heartButton?.click();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        navigateToRelativeCaption(1, "keyboard");
      }
    },
    [navigateToRelativeCaption]
  );

  const handleHeartVote = useCallback(() => {
    if (participationPendingRef.current || !current || !currentVoteKey) {
      return;
    }

    if (currentVoteStatus === "saved") {
      const voteTarget = current;

      setPendingCount((count) => count + 1);
      setError(null);
      setVoteStatus(currentVoteKey, "removing");

      removeCaptionVote({
        captionId: voteTarget.id,
        studyCaptionMappingId: voteTarget.studyCaptionMappingId,
      })
        .then((result) => {
          if (!result?.success) {
            setVoteStatus(currentVoteKey, "saved");
            setError(
              result?.error ?? "We couldn't remove your vote. Please try again."
            );
            return;
          }

          setVoteStatus(currentVoteKey, null);
          setSessionStudyStats((previousStats) => {
            const nextLikedCaptionTimeMsByKey = {
              ...previousStats.likedCaptionTimeMsByKey,
            };

            delete nextLikedCaptionTimeMsByKey[currentVoteKey];

            return {
              likedCaptionTimeMsByKey: nextLikedCaptionTimeMsByKey,
              navigationTimeMsByKey: previousStats.navigationTimeMsByKey,
              viewedCaptionKeys: previousStats.viewedCaptionKeys,
            };
          });
          resetVoteTimer();
        })
        .catch((err) => {
          console.error("[CaptionVoteFlow] remove vote failed", err);
          setVoteStatus(currentVoteKey, "saved");
          setError("We couldn't remove your vote. Please try again.");
        })
        .finally(() => {
          setPendingCount((count) => Math.max(0, count - 1));
        });

      return;
    }

    if (currentVoteStatus) {
      return;
    }

    const voteTarget = current;
    setPendingCount((count) => count + 1);
    setError(null);

    const eventDetails = createVoteEventDetails("button");

    pauseVoteTimer();
    setVoteStatus(currentVoteKey, "saving");
    triggerHeartBurst(currentVoteKey);

    saveCaptionVote({
      captionId: voteTarget.id,
      clientEventId: eventDetails.clientEventId,
      inputMethod: eventDetails.inputMethod,
      sessionId: eventDetails.sessionId,
      studyCaptionMappingId: voteTarget.studyCaptionMappingId,
      timeToVoteMs: eventDetails.timeToVoteMs,
      value: HEART_VOTE_VALUE,
    })
      .then((result) => {
        if (!result?.success) {
          setVoteStatus(currentVoteKey, null);
          setError(result?.error ?? "We couldn't save your vote. Please try again.");
          resumeVoteTimer();
          return;
        }

        setVoteStatus(currentVoteKey, "saved");
        setSessionStudyStats((previousStats) => ({
          likedCaptionTimeMsByKey: {
            ...previousStats.likedCaptionTimeMsByKey,
            [currentVoteKey]: eventDetails.timeToVoteMs,
          },
          navigationTimeMsByKey: previousStats.navigationTimeMsByKey,
          viewedCaptionKeys: {
            ...previousStats.viewedCaptionKeys,
            [currentVoteKey]: true,
          },
        }));
      })
      .catch((err) => {
        console.error("[CaptionVoteFlow] save vote failed", err);
        setVoteStatus(currentVoteKey, null);
        setError("We couldn't save your vote. Please try again.");
        resumeVoteTimer();
      })
      .finally(() => {
        setPendingCount((count) => Math.max(0, count - 1));
      });
  }, [
    createVoteEventDetails,
    current,
    currentVoteKey,
    currentVoteStatus,
    pauseVoteTimer,
    resetVoteTimer,
    resumeVoteTimer,
    setVoteStatus,
    triggerHeartBurst,
  ]);

  // Like saves in the background and immediately advances to the next caption.
  // A short cooldown (about one flip animation) keeps a rapid double click or
  // repeated key press from also liking the caption that just slid in.
  const likeAndAdvance = useCallback(
    (inputMethod: VoteInputMethod) => {
      if (participationPendingRef.current || !current || !currentVoteKey) {
        return;
      }

      const nowMs = Date.now();
      if (nowMs - lastLikeAdvanceAtMsRef.current < LIKE_ADVANCE_COOLDOWN_MS) {
        return;
      }
      lastLikeAdvanceAtMsRef.current = nowMs;

      if (!currentVoteStatus) {
        handleHeartVote();
      }

      navigateToRelativeCaption(1, inputMethod);
    },
    [current, currentVoteKey, currentVoteStatus, handleHeartVote, navigateToRelativeCaption]
  );

  const handleSwipeLike = useCallback(() => {
    likeAndAdvance("swipe");
  }, [likeAndAdvance]);

  const handleLikeVote = useCallback(() => {
    likeAndAdvance("button");
  }, [likeAndAdvance]);

  const handleCardDoubleTapHeart = useCallback(() => {
    if (
      !current ||
      !currentVoteKey ||
      currentVoteStatus === "saving" ||
      currentVoteStatus === "removing"
    ) {
      return;
    }

    handleHeartVote();
  }, [current, currentVoteKey, currentVoteStatus, handleHeartVote]);

  useEffect(() => {
    resetVoteTimer();
    resetNavigationTimer();
  }, [current?.id, resetNavigationTimer, resetVoteTimer]);

  useEffect(() => {
    if (isStartPageVisible) {
      pauseVoteTimer();
      pauseNavigationTimer();
      return;
    }

    syncVoteTimer();
    syncNavigationTimer();
  }, [
    isStartPageVisible,
    pauseNavigationTimer,
    pauseVoteTimer,
    syncNavigationTimer,
    syncVoteTimer,
  ]);

  useEffect(() => {
    if (
      isStartPageVisible ||
      !currentVoteKey ||
      isShowingCompletionPage
    ) {
      return;
    }

    setSessionStudyStats((previousStats) =>
      previousStats.viewedCaptionKeys[currentVoteKey]
        ? previousStats
        : {
            likedCaptionTimeMsByKey: previousStats.likedCaptionTimeMsByKey,
            navigationTimeMsByKey: previousStats.navigationTimeMsByKey,
            viewedCaptionKeys: {
              ...previousStats.viewedCaptionKeys,
              [currentVoteKey]: true,
            },
          }
    );
  }, [
    currentVoteKey,
    isStartPageVisible,
    isShowingCompletionPage,
  ]);

  useEffect(() => {
    if (
      nextCaptionOffset === null ||
      isLoadingMoreCaptions ||
      queue.length === 0
    ) {
      return;
    }

    const remainingCaptions = queue.length - currentIndex - 1;

    if (remainingCaptions > 12) {
      return;
    }

    void loadMoreCaptions(nextCaptionOffset);
  }, [
    currentIndex,
    isLoadingMoreCaptions,
    loadMoreCaptions,
    nextCaptionOffset,
    queue.length,
  ]);

  const syncTimers = useCallback(() => {
    syncVoteTimer();
    syncNavigationTimer();
  }, [syncNavigationTimer, syncVoteTimer]);

  useEffect(() => {
    syncTimers();

    document.addEventListener("visibilitychange", syncTimers);
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleTouchCancel, {
      passive: true,
    });
    window.addEventListener("wheel", handleWheelNavigation, { passive: false });
    window.addEventListener("keydown", handleKeyboardNavigation);
    window.addEventListener("focus", syncTimers);
    window.addEventListener("blur", syncTimers);

    return () => {
      document.removeEventListener("visibilitychange", syncTimers);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchCancel);
      window.removeEventListener("wheel", handleWheelNavigation);
      window.removeEventListener("keydown", handleKeyboardNavigation);
      window.removeEventListener("focus", syncTimers);
      window.removeEventListener("blur", syncTimers);
    };
  }, [
    handleKeyboardNavigation,
    handleTouchCancel,
    handleTouchEnd,
    handleTouchMove,
    handleTouchStart,
    handleWheelNavigation,
    syncTimers,
  ]);

  const errorReservePx = error ? (isShortViewport ? 104 : 88) : 0;

  if (!current && !isShowingCompletionPage) {
    return (
      <div
        id="vote-empty-state"
        className="glass-panel rounded-2xl border border-[var(--panel-border)] bg-[var(--surface-muted)] p-6 text-[var(--foreground)] shadow-inner"
      >
        <p className="text-lg font-semibold">You&apos;re all caught up</p>
        <p className="text-sm text-[var(--soft)]">
          We&apos;ll surface new in-study captions here as soon as they&apos;re
          ready.
        </p>
        {pendingCount > 0 ? (
          <p className="mt-3 text-xs text-[var(--soft)]">Saving your last vote...</p>
        ) : null}
      </div>
    );
  }

  return (
    <div
      id="vote-flow-frame"
      className={`relative flex h-full min-h-0 w-full flex-1 self-stretch flex-col items-center text-center ${
        isShortViewport
          ? "justify-center gap-3 pt-6 sm:gap-4 sm:pt-6"
          : "justify-start gap-4 pt-2 sm:justify-center sm:gap-5 sm:pt-3"
      }`}
      style={{
        paddingBottom: `calc(${contentBottomPaddingPx}px + env(safe-area-inset-bottom, 0px))`,
        touchAction: isShowingCompletionPage ? "auto" : "pan-x",
      }}
    >
      {error ? (
        <p role="alert" className="relative z-10 w-full max-w-xl shrink-0 rounded-xl bg-[var(--error-bg)] px-4 py-3 text-sm font-semibold text-[var(--error-text)] ring-1 ring-[var(--error-border)]">
          {error}
        </p>
      ) : null}
      {participation?.ended_at ? (
        <CompletedStudy participation={participation} />
      ) : isStartPageVisible ? (
        <StudyStartPage onStart={handleStartStudy} pending={participationPending} hasStarted={Boolean(participation?.started_at)} />
      ) : isShowingCompletionPage ? (
        <StudyEndPage
          pendingCount={pendingCount}
          onEnd={handleEndStudy}
          ending={participationPending}
        />
      ) : (
        <>
          <div className="flex w-full items-center gap-1 sm:gap-3">
          <SwipeDirectionLabel direction="pass" />
          <div className="caption-flip-stage min-w-0 flex-1">
            <div
              key={current.id}
              className={`caption-flip-card caption-flip-card--${captionFlipDirection} w-full`}
            >
              <SwipeVoteCard
                actionRow={
                  shouldShowInlineCaptionActions ? (
                    <CaptionActionRow
                      hasCurrentSavedVote={hasCurrentSavedVote}
                      isHeartPending={isCurrentVoteSaving || isCurrentVoteRemoving}
                      onHeart={handleLikeVote}
                      onPass={() => navigateToRelativeCaption(1, "button")}
                    />
                  ) : null
                }
                captionId={current.id}
                content={current.content}
                imageSrc={current.imageSrc}
                onDoubleTapHeart={handleCardDoubleTapHeart}
                onSwipeLike={handleSwipeLike}
                onSwipePass={() => navigateToRelativeCaption(1, "swipe")}
                preloadImageUrls={preloadImageUrls}
                reservedBottomPx={contentBottomPaddingPx}
                reservedTopPx={reservedTopPx + errorReservePx}
              />
            </div>
          </div>
          <SwipeDirectionLabel direction="like" />
          </div>
          {shouldShowVoteBar ? (
            <VoteButtonBar
              captionProgressLabel={captionProgressLabel}
              showHeartFallback={shouldShowVoteBar}
              onHeart={handleLikeVote}
              onPass={() => navigateToRelativeCaption(1, "button")}
              hasCurrentSavedVote={hasCurrentSavedVote}
              isPending={isCurrentVoteSaving || isCurrentVoteRemoving}
            />
          ) : null}
        </>
      )}
      {shouldShowCaptionProgress && !shouldShowVoteBar && captionProgressLabel ? (
        <CaptionProgressIndicator label={captionProgressLabel} />
      ) : null}
      {isWheelNavigationOverlayVisible ? <WheelNavigationOverlay /> : null}
    </div>
  );
}

function StudyStartPage({ onStart, pending, hasStarted }: {
  onStart: () => void;
  pending: boolean;
  hasStarted: boolean;
}) {
  return (
    <div className="flex min-h-0 w-full max-w-xl flex-1 items-center sm:max-w-2xl">
      <div data-native-scroll-region="true" className="glass-panel relative max-h-full w-full overflow-y-auto overscroll-contain rounded-[28px] border border-[var(--panel-border)] bg-[var(--vote-panel-surface)] p-6 text-left text-[var(--foreground)] shadow-[var(--vote-panel-shadow)] sm:p-8">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-20 top-8 h-36 w-36 rounded-full bg-amber-300/14 blur-3xl" />
          <div className="absolute right-0 bottom-0 h-44 w-44 translate-x-[20%] translate-y-[20%] rounded-full bg-yellow-200/12 blur-3xl" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent" />
        </div>
        <div className="relative flex flex-col gap-4 sm:gap-5">
          <h1 className="mb-2 text-center font-black uppercase tracking-[0.05em] text-[var(--foreground)] sm:mb-3">
            <span className="block text-2xl sm:text-3xl">Welcome To</span>
            <span className="mt-1 block whitespace-nowrap text-[clamp(1.1rem,6vw,2.5rem)] leading-none tracking-[0.03em] sm:text-4xl sm:tracking-[0.05em]">
              The Humor Study
              <span className="ml-0.5 inline-block align-super text-xs leading-none sm:ml-1 sm:text-lg">
                TM
              </span>
            </span>
          </h1>
          <p className="text-base leading-8 text-[var(--foreground)]/92 sm:text-lg">
            Like the captions you find funny.
          </p>
          <p className="text-base leading-8 text-[var(--foreground)]/92 sm:text-lg">
            That&apos;s it. That&apos;s all you have to do.
          </p>
          <p className="rounded-xl border border-[var(--panel-border)] bg-[var(--surface-muted)] px-4 py-3 text-sm font-semibold leading-6 text-[var(--foreground)] sm:text-base">
            Pass is on the left and Like is on the right: tap Pass or Like,
            swipe left to pass or right to like, or use the left and right
            arrow keys.
          </p>
          <p className="text-base leading-8 text-[var(--foreground)]/92 sm:text-lg">
            Scroll through all the captions, then choose End Study on the
            final page to save your completion and see your humor stats.
          </p>
          <button type="button" onClick={onStart} disabled={pending}
            className="mt-2 rounded-xl bg-[var(--accent)] px-5 py-3 text-base font-semibold text-[var(--accent-contrast)] shadow-md transition hover:-translate-y-0.5 hover:bg-[var(--accent-strong)] hover:shadow-lg active:translate-y-px active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-md">
            {pending ? "Starting…" : hasStarted ? "Continue Study" : "Start Study"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StudyEndPage({ pendingCount, onEnd, ending }: {
  pendingCount: number;
  onEnd: () => void;
  ending: boolean;
}) {
  return (
    <div className="flex min-h-0 w-full max-w-xl flex-1 items-center sm:max-w-2xl">
      <div data-native-scroll-region="true" className="glass-panel max-h-full w-full overflow-y-auto overscroll-contain rounded-[28px] border border-[var(--panel-border)] bg-[var(--vote-panel-surface)] p-6 text-center shadow-[var(--vote-panel-shadow)] sm:p-8">
        <h1 className="text-2xl font-bold sm:text-3xl">You&apos;ve reached the end!</h1>
        <p className="mt-4 text-sm leading-6 text-[var(--soft)] sm:text-base">
          End the study to save your completion and see your humor stats.
        </p>
        {pendingCount > 0 ? (
          <p role="status" className="mt-4 text-sm text-[var(--soft)]">Saving your last vote…</p>
        ) : null}
        <button type="button" onClick={onEnd} disabled={ending || pendingCount > 0}
          className="mt-6 w-full rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--accent-contrast)] disabled:cursor-wait disabled:opacity-60">
          {ending ? "Ending…" : "End Study"}
        </button>
      </div>
    </div>
  );
}

function WheelNavigationOverlay() {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center px-4 py-6 sm:px-6 sm:py-8">
      <div className="absolute inset-0 bg-[var(--overlay)]/45 backdrop-blur-[6px]" />
      <div className="glass-panel relative rounded-2xl border border-[var(--panel-border)] bg-[var(--vote-panel-surface)] px-5 py-4 text-[var(--foreground)] shadow-[var(--vote-panel-shadow)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--soft)]">
          Loading
        </p>
        <div className="mt-3 flex items-center justify-center gap-2" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)] animate-pulse" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]/80 animate-pulse [animation-delay:120ms]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]/60 animate-pulse [animation-delay:240ms]" />
        </div>
      </div>
    </div>,
    document.body
  );
}

function HeartVoteButton({
  burstToken,
  hasCurrentSavedVote,
  isPending,
  onHeart,
  size = "bar",
}: {
  burstToken: number;
  hasCurrentSavedVote: boolean;
  isPending: boolean;
  onHeart: () => void;
  size?: "bar" | "inline";
}) {
  const HeartIcon = hasCurrentSavedVote ? HeartSolidIcon : HeartOutlineIcon;
  const shouldBurst = hasCurrentSavedVote && burstToken > 0;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [burstOrigin, setBurstOrigin] = useState<{
    token: number;
    x: number;
    y: number;
  } | null>(null);
  const isInline = size === "inline";

  useLayoutEffect(() => {
    let frameId: number | null = null;

    if (!shouldBurst) {
      frameId = window.requestAnimationFrame(() => {
        setBurstOrigin(null);
      });
      return () => {
        if (frameId !== null) {
          window.cancelAnimationFrame(frameId);
        }
      };
    }

    const button = buttonRef.current;

    if (!button) {
      return;
    }

    const rect = button.getBoundingClientRect();
    frameId = window.requestAnimationFrame(() => {
      setBurstOrigin({
        token: burstToken,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
    });

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [burstToken, shouldBurst]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-heart-vote-control
        className={`relative isolate flex items-center justify-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--accent-strong)] ${
          isInline ? "h-12 w-12" : "h-14 w-14 sm:h-16 sm:w-16"
        } ${
          hasCurrentSavedVote
            ? "text-[var(--heart-active)]"
            : "text-[var(--heart-idle)] hover:-translate-y-[1px] hover:scale-[1.02] hover:text-[var(--heart-hover)]"
        } ${
          isPending ? "cursor-wait opacity-80 hover:translate-y-0 hover:scale-100" : ""
        }`}
        aria-label={
          hasCurrentSavedVote
            ? isPending
              ? "Removing heart vote"
              : "Remove heart vote"
            : isPending
              ? "Saving heart vote"
              : "Heart this caption"
        }
        aria-pressed={hasCurrentSavedVote}
        disabled={isPending}
        onClick={onHeart}
      >
        <span
          key={`heart-icon-${burstToken}`}
          className={shouldBurst ? "heart-burst-icon relative z-20" : "relative z-20"}
        >
          <HeartIcon
            className={`${
              isInline ? "h-7 w-7" : "h-9 w-9 sm:h-10 sm:w-10"
            } ${
              isPending ? "animate-pulse" : ""
            }`}
            style={
              hasCurrentSavedVote
                ? { filter: "drop-shadow(0 12px 22px var(--heart-shadow))" }
                : undefined
            }
          />
        </span>
      </button>
      {shouldBurst && burstOrigin ? (
        <HeartBurstViewportOverlay
          burstToken={burstOrigin.token}
          x={burstOrigin.x}
          y={burstOrigin.y}
        />
      ) : null}
    </>
  );
}

function SwipeDirectionLabel({ direction }: { direction: "pass" | "like" }) {
  const isPass = direction === "pass";

  return (
    <div
      data-swipe-direction-label={direction}
      aria-hidden
      className={`pointer-events-none flex w-9 shrink-0 select-none flex-col items-center justify-center gap-1 sm:w-16 lg:w-20 ${
        isPass ? "text-rose-400" : "text-emerald-400"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-7 w-7 sm:h-9 sm:w-9 lg:h-11 lg:w-11"
      >
        {isPass ? (
          <path d="M15 5l-7 7 7 7" />
        ) : (
          <path d="M9 5l7 7-7 7" />
        )}
      </svg>
      <span className="text-[10px] font-black uppercase tracking-wider sm:text-xs lg:text-sm">
        {isPass ? "Pass" : "Like"}
      </span>
    </div>
  );
}

function CaptionActionRow({
  hasCurrentSavedVote,
  isHeartPending,
  onHeart,
  onPass,
}: {
  hasCurrentSavedVote: boolean;
  isHeartPending: boolean;
  onHeart: () => void;
  onPass: () => void;
}) {
  return (
    <div className="flex w-full items-center justify-center gap-3">
      <button
        type="button"
        onClick={onPass}
        className="min-h-12 min-w-28 flex items-center justify-center gap-2 rounded-xl border border-[var(--panel-border)] bg-[var(--vote-panel-surface)] px-4 py-3 text-sm font-bold text-[var(--foreground)] transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--accent)]/15 active:translate-y-px active:scale-[0.98]"
      >
        <span aria-hidden>←</span>
        Pass
      </button>
      <button
        type="button"
        data-heart-vote-control
        disabled={isHeartPending}
        aria-pressed={hasCurrentSavedVote}
        onClick={onHeart}
        className={`flex min-h-12 min-w-28 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold transition hover:-translate-y-0.5 hover:border-rose-400 hover:bg-rose-500/15 active:translate-y-px active:scale-[0.98] disabled:cursor-wait disabled:opacity-70 ${
          hasCurrentSavedVote
            ? "border-rose-400 bg-rose-500/20 text-[var(--heart-active)]"
            : "border-[var(--panel-border)] bg-[var(--vote-panel-surface)] text-[var(--foreground)]"
        }`}
      >
        {hasCurrentSavedVote ? (
          <HeartSolidIcon className="h-5 w-5" />
        ) : (
          <HeartOutlineIcon className="h-5 w-5" />
        )}
        {isHeartPending ? "Saving…" : "Like"}
        <span aria-hidden>→</span>
      </button>
    </div>
  );
}

function VoteButtonBar({
  captionProgressLabel,
  hasCurrentSavedVote,
  isPending,
  onHeart,
  onPass,
  showHeartFallback,
}: {
  captionProgressLabel: string | null;
  hasCurrentSavedVote: boolean;
  isPending: boolean;
  onHeart: () => void;
  onPass: () => void;
  showHeartFallback: boolean;
}) {
  return (
    <div
      id="vote-button-bar-shell"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-[var(--vote-bar-from)] via-[var(--vote-bar-via)] to-transparent px-4 pt-2 sm:px-5 sm:pt-3"
      style={{
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 18px)",
      }}
    >
      <div
        id="vote-button-bar-inner"
        className="mx-auto w-full max-w-xl px-4 sm:max-w-2xl sm:px-6 lg:max-w-3xl lg:px-0"
      >
        <div className="pointer-events-auto mx-auto flex w-full max-w-md flex-col items-center gap-2 rounded-[28px] border border-[var(--panel-border)] bg-[var(--vote-panel-surface)] px-4 py-3 shadow-[var(--vote-panel-shadow)] backdrop-blur-xl sm:px-5 sm:py-3.5">
          {captionProgressLabel ? (
            <p className="text-sm font-semibold tabular-nums text-[var(--foreground)]/88">
              {captionProgressLabel}
            </p>
          ) : null}
          {showHeartFallback ? (
            <div className="flex w-full items-center justify-center gap-3">
              <button
                type="button"
                onClick={onPass}
                className="min-h-12 min-w-28 flex items-center justify-center gap-2 rounded-xl border border-[var(--panel-border)] bg-[var(--vote-panel-surface)] px-4 py-3 text-sm font-bold text-[var(--foreground)] transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--accent)]/15 active:translate-y-px active:scale-[0.98]"
              >
                <span aria-hidden>←</span>
                Pass
              </button>
              <button
                type="button"
                data-heart-vote-control
                disabled={isPending}
                aria-pressed={hasCurrentSavedVote}
                onClick={onHeart}
                className={`flex min-h-12 min-w-28 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold transition hover:-translate-y-0.5 hover:border-rose-400 hover:bg-rose-500/15 active:translate-y-px active:scale-[0.98] disabled:cursor-wait disabled:opacity-70 ${
                  hasCurrentSavedVote
                    ? "border-rose-400 bg-rose-500/20 text-[var(--heart-active)]"
                    : "border-[var(--panel-border)] bg-[var(--vote-panel-surface)] text-[var(--foreground)]"
                }`}
              >
                {hasCurrentSavedVote ? (
                  <HeartSolidIcon className="h-5 w-5" />
                ) : (
                  <HeartOutlineIcon className="h-5 w-5" />
                )}
                {isPending ? "Saving…" : "Like"}
                <span aria-hidden>→</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CaptionProgressIndicator({
  label,
}: {
  label: string;
}) {
  return (
    <div
      id="caption-progress-indicator"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4"
      style={{
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
      }}
      aria-hidden
    >
      <div className="glass-panel rounded-full border border-[var(--panel-border)] bg-[var(--vote-panel-surface)] px-4 py-2 shadow-[var(--vote-panel-shadow)] backdrop-blur-xl">
        <p className="text-sm font-semibold tabular-nums text-[var(--foreground)]/88">
          {label}
        </p>
      </div>
    </div>
  );
}

function HeartBurstViewportOverlay({
  burstToken,
  x,
  y,
}: {
  burstToken: number;
  x: number;
  y: number;
}) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      key={`heart-burst-viewport-${burstToken}`}
      className="heart-burst-viewport pointer-events-none fixed inset-0 z-[80] overflow-hidden"
      aria-hidden
    >
      <span
        className="heart-burst-screenwash absolute inset-0"
        style={
          {
            "--heart-burst-origin-x": `${x}px`,
            "--heart-burst-origin-y": `${y}px`,
          } as CSSProperties
        }
      />
      <span className="heart-burst-flash absolute" style={{ left: x, top: y }} />
      <span
        className="heart-burst-flash heart-burst-flash--secondary absolute"
        style={{ left: x, top: y }}
      />
      <span className="heart-burst-ring absolute" style={{ left: x, top: y }} />
      <span
        className="heart-burst-ring heart-burst-ring--outer absolute"
        style={{ left: x, top: y }}
      />
      <span
        className="heart-burst-shockwave absolute"
        style={{ left: x, top: y }}
      />
      {HEART_BURST_PARTICLES.map((particle, index) => (
        <span
          key={index}
          className="heart-burst-particle absolute"
          style={
            {
              left: x,
              top: y,
              "--heart-burst-x": `${particle.x}px`,
              "--heart-burst-y": `${particle.y}px`,
              "--heart-burst-delay": `${particle.delayMs}ms`,
              "--heart-burst-duration": `${particle.durationMs}ms`,
              "--heart-burst-size": `${particle.sizePx}px`,
              "--heart-burst-rotate": `${particle.rotateDeg}deg`,
              "--heart-burst-stretch": `${particle.stretch}`,
            } as CSSProperties
          }
        />
      ))}
    </div>,
    document.body
  );
}
