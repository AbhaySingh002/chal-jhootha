import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Hand as HandIcon } from 'lucide-react';
import { Card as CardComponent } from './Card';
import { useGameStore } from '../state/gameStore';

type HandDensity = 'phone' | 'regular' | 'short';

const getHandDensity = (): HandDensity => {
  if (typeof window === 'undefined') return 'regular';
  if (window.innerHeight <= 620 && window.innerWidth > window.innerHeight) return 'short';
  return window.innerWidth < 640 ? 'phone' : 'regular';
};

export const Hand: React.FC<{ selectedCards: string[]; onSelect: (id: string) => void; concealedCardIds?: string[]; selectionLocked?: boolean }> = ({ selectedCards, onSelect, concealedCardIds = [], selectionLocked = false }) => {
  const { myHand } = useGameStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ scrollLeft: 0, clientWidth: 0, isOverflowing: false });
  const [handDensity, setHandDensity] = useState<HandDensity>(getHandDensity);
  const scrollFrameRef = useRef<number | null>(null);

  const total = myHand.length;

  const updateScrollState = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const next = {
      scrollLeft: container.scrollLeft,
      clientWidth: container.clientWidth,
      isOverflowing: container.scrollWidth > container.clientWidth + 8,
    };
    setScrollState((current) => (
      current.scrollLeft === next.scrollLeft && current.clientWidth === next.clientWidth && current.isOverflowing === next.isOverflowing
        ? current
        : next
    ));
  }, []);

  const scheduleScrollState = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      updateScrollState();
    });
  }, [updateScrollState]);

  useEffect(() => {
    updateScrollState();
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleResize = () => {
      setHandDensity(getHandDensity());
      scheduleScrollState();
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    };
  }, [total, scheduleScrollState, updateScrollState]);

  const handleScroll = scheduleScrollState;

  if (myHand.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-ink/40 bg-paper/60 px-4 py-4 text-center font-mono text-xs font-bold uppercase tracking-[0.1em] text-ink-muted">
        No cards in hand
      </div>
    );
  }

  const mid = (total - 1) / 2;
  const isCompact = handDensity !== 'regular';
  const cardWidth = handDensity === 'short' ? 68 : handDensity === 'phone' ? 72 : 96;
  const step = handDensity === 'short' ? 24 : handDensity === 'phone' ? 28 : 36;
  const sidePadding = handDensity === 'short' ? 28 : isCompact ? 40 : 64;

  return (
    <section data-hand-anchor data-hand-density={handDensity} aria-label="Your hand" className="game-hand w-full max-w-[100vw] border-t-2 border-ink/20 bg-paper/90 backdrop-blur-sm px-2 pb-3 pt-2 sm:px-4 select-none">
      <div className="mb-1 flex items-center justify-between gap-3 px-2 font-mono text-xs font-bold uppercase tracking-[0.1em] text-ink-muted">
        <span className="flex items-center gap-1.5">
          <HandIcon size={15} strokeWidth={2.5} className="text-evidence-red" />
          <span>Your Hand</span>
        </span>
        <span className="rounded-md bg-surface px-2 py-0.5 text-[11px] text-ink shadow-[1px_1px_0_var(--color-ink)]">
          {selectedCards.length > 0 ? `${selectedCards.length} of ${myHand.length} selected` : `${myHand.length} cards`}
        </span>
      </div>

      {/* Fanned Arc Bounded Scroll Container */}
      <div
        data-hand-scroll
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="no-scrollbar flex min-h-[9.5rem] sm:min-h-[12rem] items-end overflow-x-auto overflow-y-visible py-4 touch-pan-x"
        style={{
          overscrollBehaviorX: 'contain',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <div
          className={`flex items-end mx-auto py-2 transition-all ${
            scrollState.isOverflowing ? 'justify-start' : 'justify-center'
          }`}
          style={{ paddingInline: `${sidePadding}px` }}
        >
          {myHand.map((card, idx) => {
            let rotation = 0;
            let arcY = 0;

            if (!scrollState.isOverflowing || scrollState.clientWidth === 0) {
              // Static balanced fan layout when cards fit comfortably
              const dist = idx - mid;
              const maxAngle = Math.min(12, Math.max(4, total * 2.2));
              rotation = total > 1 && mid > 0 ? (dist / mid) * maxAngle : 0;
              arcY = total > 1 && mid > 0 ? Math.pow(Math.abs(dist) / mid, 1.6) * Math.min(7, total * 1.225) : 0;
            } else {
              // Dynamic arc calculation based on position relative to visible center
              const cardCenter = sidePadding + (cardWidth / 2) + idx * step;
              const visibleCenter = scrollState.scrollLeft + scrollState.clientWidth / 2;
              const normalizedDist = Math.max(-1.4, Math.min(1.4, (cardCenter - visibleCenter) / (scrollState.clientWidth * 0.42)));

              rotation = normalizedDist * 13;
              arcY = Math.pow(Math.abs(normalizedDist), 1.6) * 7;
            }

            return (
              <div
                key={card.id}
                style={{
                  marginLeft: idx > 0 ? `${-(cardWidth - step)}px` : 0,
                  zIndex: idx + 1,
                }}
              >
                <CardComponent
                  card={card}
                  className="hand-playing-card"
                  selected={selectedCards.includes(card.id)}
                  rotation={rotation}
                  arcY={arcY}
                  zIndex={idx + 1}
                  concealed={concealedCardIds.includes(card.id)}
                  onClick={selectionLocked ? undefined : () => onSelect(card.id)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
