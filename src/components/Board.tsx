import { useEffect, useMemo, useRef } from 'react';
import { useUI } from '../ui';
import { addDays } from '../lib/dates';
import { DayColumn } from './DayColumn';

const DAYS_SHOWN = 10;

export function Board({ todayAddRef }: { todayAddRef: React.RefObject<HTMLInputElement> }) {
  const boardStart = useUI((s) => s.boardStart);
  const today = useUI((s) => s.today);
  const scroller = useRef<HTMLDivElement>(null);
  const days = useMemo(() => Array.from({ length: DAYS_SHOWN }, (_, i) => addDays(boardStart, i)), [boardStart]);

  useEffect(() => {
    scroller.current?.scrollTo({ left: 0 });
  }, [boardStart]);

  return (
    <div className="board" ref={scroller}>
      {days.map((d) => (
        <DayColumn key={d} date={d} addRef={d === today ? todayAddRef : undefined} />
      ))}
    </div>
  );
}
