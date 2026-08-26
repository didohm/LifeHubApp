import { useState, useEffect } from "react";
import {
  Search,
  X,
  Calendar,
  Wallet,
  Pill,
  FileText,
  CheckSquare,
  Dumbbell,
  FileSearch,
  ArrowRight,
  Cake,
} from "lucide-react";
import { performGlobalSearch } from "../../lib/api";
import { GlobalSearchResult } from "../../lib/types";
import { useNavigate } from "@tanstack/react-router";
import { Modal } from "./Modal";

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
}

export function GlobalSearchModal({ isOpen, onClose, userId }: GlobalSearchModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await performGlobalSearch(userId, query);
        setResults(res);
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query, userId]);

  if (!isOpen) return null;

  const getIcon = (type: string) => {
    switch (type) {
      case "appointment":
        return <Calendar className="size-4 text-amber-600" />;
      case "bill":
        return <Wallet className="size-4 text-rose-600" />;
      case "medication":
        return <Pill className="size-4 text-sky-600" />;
      case "document":
        return <FileText className="size-4 text-indigo-600" />;
      case "todo":
        return <CheckSquare className="size-4 text-emerald-600" />;
      case "workout":
        return <Dumbbell className="size-4 text-lime-600" />;
      case "birthday":
        return <Cake className="size-4 text-pink-500" />;
      default:
        return <FileSearch className="size-4 text-purple-600" />;
    }
  };

  const handleSelect = (url: string) => {
    onClose();
    navigate({ to: url as any });
  };

  return (
    <Modal open={isOpen} onClose={onClose} alignTop className="bg-card">
      <div className="flex items-center gap-3 border-b border-border/50 pb-3">
        <Search className="size-5 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search appointments, bills, meds, docs, tasks..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          className="flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          onClick={onClose}
          aria-label="Close search"
          className="tap flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-3 max-h-80 overflow-y-auto space-y-2">
        {loading && <p className="p-4 text-center text-sm text-muted-foreground">Searching...</p>}
        {!loading && query && results.length === 0 && (
          <p className="p-4 text-center text-sm text-muted-foreground">
            No matches found for &quot;{query}&quot;
          </p>
        )}

        {results.map((res) => (
          <button
            key={res.id}
            onClick={() => handleSelect(res.url)}
            className="tap flex w-full items-center justify-between rounded-xl p-3 min-h-[56px] text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFC] focus-visible:ring-inset"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-10 min-h-[40px] min-w-[40px] items-center justify-center rounded-lg bg-muted shrink-0">
                {getIcon(res.type)}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{res.title}</p>
                <p className="text-xs text-muted-foreground">{res.subtitle}</p>
              </div>
            </div>
            <ArrowRight className="size-4 text-muted-foreground shrink-0" />
          </button>
        ))}
      </div>
    </Modal>
  );
}
