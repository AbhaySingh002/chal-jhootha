import React from 'react';
import { Hand as HandIcon } from 'lucide-react';
import { Card as CardComponent } from './Card';
import { useGameStore } from '../state/gameStore';

export const Hand: React.FC<{ selectedCards: string[]; onSelect: (id: string) => void }> = ({ selectedCards, onSelect }) => {
  const { myHand } = useGameStore();

  if (myHand.length === 0) {
    return <div className="border-2 border-dashed border-ink bg-paper px-4 py-3 text-center font-mono text-xs font-bold uppercase tracking-[0.1em] text-ink-muted">No cards in hand</div>;
  }

  return (
    <section aria-label="Your hand" className="max-w-[100vw] border-t-3 border-ink bg-paper px-3 pb-3 pt-2 sm:px-4">
      <div className="mb-2 flex items-center justify-between gap-3 font-mono text-xs font-bold uppercase tracking-[0.1em] text-ink-muted"><span className="flex items-center gap-2"><HandIcon size={17} strokeWidth={2.5} />Your hand</span><span>{selectedCards.length > 0 ? `${selectedCards.length} selected` : `${myHand.length} cards`}</span></div>
      <div className="no-scrollbar flex min-h-28 gap-2 overflow-x-auto overflow-y-visible px-1 pb-3 pt-3 touch-pan-x" style={{ overscrollBehaviorX: 'contain', WebkitOverflowScrolling: 'touch', maxWidth: '100%' }}>
        {myHand.map((card) => <CardComponent key={card.id} card={card} selected={selectedCards.includes(card.id)} onClick={() => onSelect(card.id)} />)}
      </div>
    </section>
  );
};
