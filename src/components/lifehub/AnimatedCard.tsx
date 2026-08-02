import { ReactNode } from 'react';

interface AnimatedCardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  delayMs?: number;
}

export function AnimatedCard({ children, className = '', onClick, delayMs = 0 }: AnimatedCardProps) {
  return (
    <div
      onClick={onClick}
      style={{ animationDelay: `${delayMs}ms` }}
      className={`card-soft transition-all duration-300 hover:shadow-md active:scale-[0.98] ${
        onClick ? 'cursor-pointer' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}
