import React, { useRef, useState, useLayoutEffect, useEffect } from 'react';
import { Card as CardComponent } from './Card';
import { useGameStore } from '../state/gameStore';
import { motion, AnimatePresence, useScroll, useTransform, MotionValue } from 'framer-motion';
import type { Card } from 'shared';

const CurvedCardWrapper = ({
  card,
  selected,
  onSelect,
  i,
  scrollX,
  containerRef,
  totalCards
}: {
  card: Card;
  selected: boolean;
  onSelect: (id: string) => void;
  i: number;
  scrollX: MotionValue<number>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  totalCards: number;
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardCenter, setCardCenter] = useState(0);

  useLayoutEffect(() => {
    const updateCenter = () => {
      if (cardRef.current && containerRef.current) {
        setCardCenter(cardRef.current.offsetLeft + cardRef.current.offsetWidth / 2);
      }
    };
    updateCenter();
    const timeout = setTimeout(updateCenter, 100);
    window.addEventListener('resize', updateCenter);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('resize', updateCenter);
    };
  }, [totalCards, containerRef]);

  const distance = useTransform(scrollX, (x) => {
    if (!containerRef.current) return 0;
    const containerWidth = containerRef.current.offsetWidth;
    const viewportCenter = x + containerWidth / 2;
    return cardCenter - viewportCenter;
  });

  const rotation = useTransform(distance, [-500, 0, 500], [-35, 0, 35]);
  const yOffset = useTransform(distance, [-500, 0, 500], [60, 0, 60]);

  return (
    <motion.div
      ref={cardRef}
      style={{
        rotate: rotation,
        y: yOffset,
        zIndex: i,
        transformOrigin: 'bottom center',
      }}
      className="flex-shrink-0"
    >
      <CardComponent
        card={card}
        selected={selected}
        onClick={() => onSelect(card.id)}
      />
    </motion.div>
  );
};

export const Hand: React.FC<{
  selectedCards: string[];
  onSelect: (id: string) => void;
}> = ({ selectedCards, onSelect }) => {
  const { myHand } = useGameStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const scrollLeftStart = useRef(0);
  const hasMoved = useRef(false);

  const { scrollX } = useScroll({ container: containerRef });

  // Convert vertical mouse wheel to horizontal scroll seamlessly
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    isDragging.current = true;
    hasMoved.current = false;
    startX.current = e.pageX - containerRef.current.offsetLeft;
    scrollLeftStart.current = containerRef.current.scrollLeft;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current || !containerRef.current) return;
    const x = e.pageX - containerRef.current.offsetLeft;
    const walk = (x - startX.current) * 1.5;
    if (Math.abs(walk) > 5) {
      hasMoved.current = true;
    }
    containerRef.current.scrollLeft = scrollLeftStart.current - walk;
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  const handleCardClick = (id: string) => {
    if (hasMoved.current) {
      hasMoved.current = false;
      return;
    }
    onSelect(id);
  };

  if (myHand.length === 0) {
    return (
      <div className="fixed bottom-6 left-0 right-0 flex justify-center pointer-events-none z-10 px-4">
        <div className="bg-white border-2 border-dashed border-ink px-6 py-3 rounded-xl font-mono text-xs font-bold text-ink uppercase tracking-widest shadow-[3px_3px_0_#14140F]">
          EVIDENCE PURGED // AWAITING VERDICT
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 p-2 sm:p-4 pb-safe flex justify-center items-end h-[36vh] sm:h-[40vh] pointer-events-none z-10">
      <div 
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="w-full flex items-end overflow-x-auto no-scrollbar pointer-events-auto touch-pan-x cursor-grab active:cursor-grabbing select-none"
        style={{ 
          WebkitOverflowScrolling: 'touch',
          overscrollBehaviorX: 'contain' 
        }}
      >
        <motion.div 
          className="flex -space-x-7 sm:-space-x-11 pb-6 sm:pb-8 pt-10 px-[15vw] sm:px-20 min-w-max mx-auto items-end"
          layout
        >
          <AnimatePresence mode="popLayout">
            {myHand.map((card, i) => (
              <CurvedCardWrapper
                key={card.id}
                card={card}
                selected={selectedCards.includes(card.id)}
                onSelect={handleCardClick}
                i={i}
                scrollX={scrollX}
                containerRef={containerRef}
                totalCards={myHand.length}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
};
