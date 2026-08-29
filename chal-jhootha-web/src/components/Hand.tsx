import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Hand as HandIcon } from 'lucide-react';
import { Card as CardComponent } from './Card';
import { useGameStore } from '../state/gameStore';

export const Hand: React.FC<{ selectedCards: string[]; onSelect: (id: string) => void; concealedCardIds?: string[] }> = ({ selectedCards, onSelect, concealedCardIds = [] }) => {
  const { myHand } = useGameStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ scrollLeft: 0, clientWidth: 0, isOverflowing: false });
  const scrollFrameRef = useRef<number | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; scrollLeft: number; didDrag: boolean } | null>(null);
  const suppressClickRef = useRef(false);

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

    const handleResize = () => scheduleScrollState();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    };
  }, [total, scheduleScrollState, updateScrollState]);

  const handleScroll = scheduleScrollState;

  // Touch scroll remains native; mouse/pen get drag-to-scroll without turning a drag into a card selection.
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, scrollLeft: container.scrollLeft, didDrag: false };
    container.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const deltaX = e.clientX - drag.startX;
    if (Math.abs(deltaX) > 5) {
      drag.didDrag = true;
      e.preventDefault();
    }
    if (drag.didDrag) container.scrollLeft = drag.scrollLeft - deltaX;
  };

  const finishPointerDrag = (e: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    suppressClickRef.current = !cancelled && drag.didDrag;
    dragRef.current = null;
    const container = scrollContainerRef.current;
    if (container?.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
  };

  const suppressDragClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressClickRef.current = false;
    }
  };

  if (myHand.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-ink/40 bg-paper/60 px-4 py-4 text-center font-mono text-xs font-bold uppercase tracking-[0.1em] text-ink-muted">
        No cards in hand
      </div>
    );
  }

  const mid = (total - 1) / 2;
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const step = isMobile ? 28 : 36;
  const cardWidth = isMobile ? 72 : 96;

  return (
    <section data-hand-anchor aria-label="Your hand" className="w-full max-w-[100vw] border-t-2 border-ink/20 bg-paper/90 backdrop-blur-sm px-2 pb-3 pt-2 sm:px-4 select-none">
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
        ref={scrollContainerRef}
        onScroll={handleScroll}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerDrag}
        onPointerCancel={(e) => finishPointerDrag(e, true)}
        onLostPointerCapture={(e) => finishPointerDrag(e, true)}
        onClickCapture={suppressDragClick}
        className="no-scrollbar flex min-h-[9.5rem] sm:min-h-[12rem] items-end overflow-x-auto overflow-y-visible py-4 touch-pan-x cursor-grab active:cursor-grabbing"
        style={{
          overscrollBehaviorX: 'contain',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <div
          className={`flex items-end mx-auto px-10 sm:px-16 py-2 transition-all ${
            scrollState.isOverflowing ? 'justify-start' : 'justify-center'
          }`}
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
              const cardCenter = (isMobile ? 40 : 64) + (cardWidth / 2) + idx * step;
              const visibleCenter = scrollState.scrollLeft + scrollState.clientWidth / 2;
              const normalizedDist = Math.max(-1.4, Math.min(1.4, (cardCenter - visibleCenter) / (scrollState.clientWidth * 0.42)));

              rotation = normalizedDist * 13;
              arcY = Math.pow(Math.abs(normalizedDist), 1.6) * 7;
            }

            return (
              <div
                key={card.id}
                className={idx > 0 ? '-ml-[46px] sm:-ml-[62px]' : 'ml-0'}
                style={{
                  zIndex: selectedCards.includes(card.id) ? 40 : idx + 1,
                }}
              >
                <CardComponent
                  card={card}
                  selected={selectedCards.includes(card.id)}
                  rotation={rotation}
                  arcY={arcY}
                  zIndex={idx + 1}
                  concealed={concealedCardIds.includes(card.id)}
                  onClick={() => onSelect(card.id)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
