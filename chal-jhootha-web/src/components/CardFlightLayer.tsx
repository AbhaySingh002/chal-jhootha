import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Card } from './Card';

export interface FlightPoint {
  x: number;
  y: number;
  scale: number;
}

export interface CardFlight {
  id: string;
  source: FlightPoint;
  target: FlightPoint;
  delay: number;
  revealCardId?: string;
}

interface CardFlightLayerProps {
  flights: CardFlight[];
  onFlightComplete: (flight: CardFlight) => void;
}

export const CardFlightLayer: React.FC<CardFlightLayerProps> = ({ flights, onFlightComplete }) => {
  const reduceMotion = useReducedMotion();
  const completedIds = useRef(new Set<string>());

  useEffect(() => {
    if (!reduceMotion) return;
    flights.forEach((flight) => {
      if (completedIds.current.has(flight.id)) return;
      completedIds.current.add(flight.id);
      onFlightComplete(flight);
    });
  }, [flights, onFlightComplete, reduceMotion]);

  if (reduceMotion) return null;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      <AnimatePresence initial={false}>
        {flights.map((flight) => (
          <motion.div
            key={flight.id}
            className="pointer-events-none fixed left-0 top-0 origin-center"
            initial={{ x: flight.source.x, y: flight.source.y, scale: flight.source.scale, rotate: -7, opacity: 1 }}
            animate={{ x: flight.target.x, y: flight.target.y, scale: flight.target.scale, rotate: 3, opacity: 0.15 }}
            exit={{ opacity: 0, scale: flight.target.scale * 0.92 }}
            transition={{ duration: 0.42, delay: flight.delay, ease: [0.22, 0.8, 0.28, 1] }}
            onAnimationComplete={() => {
              if (completedIds.current.has(flight.id)) return;
              completedIds.current.add(flight.id);
              onFlightComplete(flight);
            }}
          >
            <Card faceDown />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
