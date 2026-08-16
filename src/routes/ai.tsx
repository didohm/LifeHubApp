import { useState, useEffect, useRef, useCallback } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Send,
  Plus,
  Trash2,
  Bot,
  User as UserIcon,
  FileText,
  Pill,
  Calendar,
  MessageSquare,
  Copy,
  Check,
  Leaf,
  Search,
  ScrollText,
  ArrowDown,
  X,
  Square,
  History,
  ChevronRight,
  HelpCircle,
  Activity,
  StopCircle,
  TrendingUp,
  Brain,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Screen } from "@/components/lifehub/Screen";
import { Modal } from "@/components/lifehub/Modal";
import { useAuth } from "@/hooks/use-auth";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { generateAssistantReply } from "@/lib/ai-provider";
import {
  getAiConversations,
  createAiConversation,
  deleteAiConversation,
  getAiMessages,
  addAiMessage,
} from "@/lib/api";
import { AiConversation, AiMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { sounds } from "@/lib/sound";
import { GlobalSearchModal } from "@/components/lifehub/GlobalSearchModal";
import { UserAvatar } from "@/components/lifehub/UserAvatar";

export const Route = createFileRoute("/ai")({
  head: () => ({
    meta: [{ title: "AI Health Assistant — LifeHub" }],
  }),
  component: AiPage,
});

// ─── Quick Action Cards (Empty State) ────────────────────────────────
const quickActions = [
  {
    icon: Pill,
    title: "Medication Plan",
    desc: "Dosage, schedule & safety",
    prompt: "Walk me through my current medication schedule — what I should take and when.",
    color: "from-blue-500/10 to-sky-500/10 border-sky-500/20 text-sky-700",
    badge: "Prescriptions",
  },
  {
    icon: Calendar,
    title: "Doctor Appointment",
    desc: "Questions & prep notes",
    prompt: "I have an upcoming doctor appointment. Help me prepare questions to ask and documents to bring.",
    color: "from-amber-500/10 to-orange-500/10 border-amber-500/20 text-amber-700",
    badge: "Preparation",
  },
  {
    icon: ScrollText,
    title: "Health Summary",
    desc: "Overview of your health data",
    prompt: "Summarize all my health records — medications, appointments, and recent activities.",
    color: "from-purple-500/10 to-indigo-500/10 border-purple-500/20 text-purple-700",
    badge: "Records",
  },
  {
    icon: Leaf,
    title: "Daily Wellness",
    desc: "Actionable routine advice",
    prompt: "Give me personalized wellness and hydration tips based on my recent activity.",
    color: "from-emerald-500/10 to-teal-500/10 border-emerald-500/20 text-emerald-700",
    badge: "Lifestyle",
  },
];

// ─── Suggested Prompt Chips ──────────────────────────────────────────
const suggestedPrompts = [
  { icon: Pill, label: "What meds do I take today?" },
  { icon: Activity, label: "Summarize my walk & workouts" },
  { icon: Calendar, label: "Next upcoming appointment?" },
  { icon: FileText, label: "Explain my lab results" },
  { icon: HelpCircle, label: "How to improve my sleep?" },
];

// ─── Follow-up Prompts ───────────────────────────────────────────────
const defaultFollowUps = [
  "Can you explain this in simpler terms?",
  "What steps should I take next?",
  "Are there any side effects or precautions?",
  "Summarize key takeaways as a bulleted checklist",
];

// ─── Helper: Time-based greeting ─────────────────────────────────────
function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ─── Markdown Renderer (High Performance & Responsive) ───────────────
function MarkdownContent({ content }: { content: string }) {
  const [copiedCodeIdx, setCopiedCodeIdx] = useState<number | null>(null);

  const handleCopyCode = async (code: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCodeIdx(idx);
      sounds.playClick();
      setTimeout(() => setCopiedCodeIdx(null), 2000);
    } catch {
      // silent
    }
  };

  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeBlockIndex = 0;

  const flushCodeBlock = (key: number) => {
    if (codeLines.length > 0) {
      const codeText = codeLines.join("\n");
      const currentIdx = codeBlockIndex++;
      elements.push(
        <div key={key} className="relative my-2 rounded-xl bg-slate-900 text-slate-100 p-3 text-xs">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-[10px] text-slate-400">
            <span>Code</span>
            <button
              onClick={() => handleCopyCode(codeText, currentIdx)}
              className="flex items-center gap-1 hover:text-white transition-colors"
            >
              {copiedCodeIdx === currentIdx ? (
                <>
                  <Check className="size-3 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="size-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
          <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed">
            <code>{codeText}</code>
          </pre>
        </div>,
      );
      codeLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("```")) {
      if (inCodeBlock) {
        flushCodeBlock(i);
        inCodeBlock = false;
      } else {
        flushCodeBlock(i);
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (line.trim() === "") {
      elements.push(<div key={`p-${i}`} className="h-1.5" />);
      continue;
    }

    // Markdown Tables
    if (line.startsWith("|") && line.endsWith("|")) {
      const cells = line.split("|").filter(Boolean);
      if (i + 1 < lines.length && lines[i + 1].match(/^[\s|:-]+$/)) {
        const headerCells = cells.map((c, ci) => (
          <th key={ci} className="px-3 py-2 text-left text-xs font-bold text-foreground">
            {c.trim()}
          </th>
        ));
        i++;
        const rows: React.ReactNode[] = [];
        while (i + 1 < lines.length && lines[i + 1].startsWith("|")) {
          i++;
          const rowCells = lines[i]
            .split("|")
            .filter(Boolean)
            .map((c, ci) => (
              <td key={ci} className="px-3 py-1.5 text-xs text-foreground/90 border-t border-border/40">
                {renderInline(c.trim())}
              </td>
            ));
          rows.push(<tr key={`tr-${i}`} className="hover:bg-muted/30">{rowCells}</tr>);
        }
        elements.push(
          <div key={`tbl-${i}`} className="my-2.5 overflow-x-auto rounded-xl border border-border/60 bg-card/60 shadow-xs">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-muted/60">{headerCells}</thead>
              <tbody>{rows}</tbody>
            </table>
          </div>,
        );
        continue;
      }
    }

    // Headers
    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={i} className="mt-3 mb-1 text-sm font-bold text-foreground">
          {renderInline(line.slice(4))}
        </h3>,
      );
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(
        <h2 key={i} className="mt-3.5 mb-1.5 text-[15px] font-extrabold text-foreground">
          {renderInline(line.slice(3))}
        </h2>,
      );
      continue;
    }
    if (line.startsWith("# ")) {
      elements.push(
        <h1 key={i} className="mt-4 mb-2 text-base font-black text-foreground">
          {renderInline(line.slice(2))}
        </h1>,
      );
      continue;
    }

    // Bulleted lists
    if (line.match(/^[\s]*[-*+]\s/)) {
      const indent = line.match(/^[\s]*/)?.[0].length || 0;
      const text = line.replace(/^[\s]*[-*+]\s/, "");
      elements.push(
        <div key={i} className="flex gap-2 pl-2" style={{ paddingLeft: `${indent + 8}px` }}>
          <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[#7C5CFC]" />
          <span className="text-[13.5px] leading-relaxed text-foreground/90">{renderInline(text)}</span>
        </div>,
      );
      continue;
    }

    // Numbered lists
    if (line.match(/^\d+[.)]\s/)) {
      const match = line.match(/^(\d+[.)])\s/);
      const text = line.replace(/^\d+[.)]\s/, "");
      elements.push(
        <div key={i} className="flex gap-2 pl-2">
          <span className="mt-0.5 shrink-0 text-xs font-bold text-[#7C5CFC]">{match?.[1]}</span>
          <span className="text-[13.5px] leading-relaxed text-foreground/90">{renderInline(text)}</span>
        </div>,
      );
      continue;
    }

    // Blockquotes
    if (line.startsWith("> ")) {
      elements.push(
        <blockquote
          key={i}
          className="my-2 rounded-r-xl border-l-3 border-[#7C5CFC] bg-[#7C5CFC]/5 px-3 py-1.5 text-xs text-foreground/85 italic"
        >
          {renderInline(line.slice(2))}
        </blockquote>,
      );
      continue;
    }

    // Standard paragraph
    elements.push(
      <p key={i} className="text-[13.5px] leading-relaxed text-foreground/90">
        {renderInline(line)}
      </p>,
    );
  }

  if (inCodeBlock && codeLines.length > 0) {
    flushCodeBlock(lines.length);
  }

  return <div className="space-y-1.5">{elements}</div>;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-bold text-foreground">{part.slice(2, -2)}</strong>;
    }
    const italicParts = part.split(/(_[^_]+_)/g);
    return italicParts.map((ip, j) => {
      if (ip.startsWith("_") && ip.endsWith("_")) {
        return <em key={`${i}-${j}`} className="italic">{ip.slice(1, -1)}</em>;
      }
      return ip;
    });
  });
}

// ─── Typing Indicator ────────────────────────────────────────────────
function TypingIndicator({ onStop }: { onStop?: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      className="flex items-start gap-2.5 my-1"
    >
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#7C5CFC]/15 text-[#7C5CFC] shadow-xs">
        <Bot className="size-4" />
      </div>
      <div className="flex items-center gap-3 rounded-2xl rounded-tl-sm bg-[#F5F3FF] border border-[#7C5CFC]/20 px-3.5 py-2.5 shadow-xs">
        <div className="flex gap-1 items-center">
          <span
            className="size-2 animate-bounce rounded-full bg-[#7C5CFC]"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="size-2 animate-bounce rounded-full bg-[#7C5CFC]"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="size-2 animate-bounce rounded-full bg-[#7C5CFC]"
            style={{ animationDelay: "300ms" }}
          />
        </div>
        <span className="text-xs font-semibold text-muted-foreground">Thinking...</span>
        {onStop && (
          <button
            onClick={onStop}
            className="ml-2 flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-[11px] font-bold text-slate-700 shadow-xs border border-slate-200 hover:bg-slate-50 transition-colors"
          >
            <Square className="size-2.5 fill-current" />
            Stop
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── Main Page Component ────────────────────────────────────────────
function AiPage() {
  const { user, firebaseUser, loading: authLoading } = useAuth();
  useAuthGuard(user, authLoading);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [inputPrompt, setInputPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");

  // Track virtual keyboard on mobile devices
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const handleResize = () => {
      const keyboardActive = window.innerHeight - vv.height > 60;
      setIsKeyboardOpen(keyboardActive);
    };
    vv.addEventListener("resize", handleResize);
    return () => vv.removeEventListener("resize", handleResize);
  }, []);

  // Load conversations
  const loadConvs = useCallback(async () => {
    if (!user) return;
    try {
      const convs = await getAiConversations(user.id);
      setConversations(convs);
      if (convs.length > 0 && !activeConvId) {
        setActiveConvId(convs[0].id);
      } else if (convs.length === 0) {
        const newConv = await createAiConversation(user.id, "Health Chat");
        setConversations([newConv]);
        setActiveConvId(newConv.id);
      }
    } catch {
      // silent
    }
  }, [user, activeConvId]);

  useEffect(() => {
    if (user) loadConvs();
  }, [user, loadConvs]);

  // Load messages for active conversation
  useEffect(() => {
    if (activeConvId && user) {
      getAiMessages(activeConvId, user.id).then((msgs) => {
        setMessages(msgs);
        setTimeout(() => {
          chatEndRef.current?.scrollIntoView({ behavior: "instant" });
        }, 50);
      });
    }
  }, [activeConvId, user]);

  // Scroll detection for "Jump to Bottom" button
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBottom(distanceToBottom > 180);
  };

  const scrollToBottom = (smooth = true) => {
    chatEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  };

  // Auto scroll on new messages
  useEffect(() => {
    scrollToBottom(true);
  }, [messages, loading]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
    }
  }, [inputPrompt]);

  // Stop Generation
  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
  };

  // ─── Send Message ──────────────────────────────────────────────
  const handleSend = async (customPrompt?: string) => {
    const promptToSend = customPrompt || inputPrompt.trim();
    if (!promptToSend || !user || !activeConvId) return;
    if (loading) return;

    setInputPrompt("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    setLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const userMsg = await addAiMessage(activeConvId, "user", promptToSend, user.id);
      setMessages((prev) => [...prev, userMsg]);

      // Firebase ID token authenticates the server-side model proxy
      const idToken = firebaseUser
        ? await firebaseUser.getIdToken().catch(() => undefined)
        : undefined;

      const replyText = await generateAssistantReply({
        prompt: promptToSend,
        userId: user.id,
        idToken,
        signal: controller.signal,
        conversationHistory: [...messages, userMsg].map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        })),
      });

      const aiMsg = await addAiMessage(activeConvId, "assistant", replyText, user.id);
      setMessages((prev) => [...prev, aiMsg]);
      sounds.playActionClick();
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        toast.info("Generation stopped");
      } else {
        toast.error("Couldn't get a response right now. Please try again.");
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  // ─── New Conversation ──────────────────────────────────────────
  const handleNewChat = async () => {
    if (!user) return;
    try {
      const newConv = await createAiConversation(user.id, "Health Chat");
      setConversations((prev) => [newConv, ...prev]);
      setActiveConvId(newConv.id);
      setMessages([]);
      setHistoryModalOpen(false);
      toast.success("New conversation started");
    } catch {
      toast.error("Failed to start new chat");
    }
  };

  // ─── Delete Conversation ───────────────────────────────────────
  const handleDeleteChat = async (id: string) => {
    if (!user) return;
    try {
      await deleteAiConversation(id, user.id);
      const updated = conversations.filter((c) => c.id !== id);
      setConversations(updated);
      if (activeConvId === id) {
        const nextActive = updated.length > 0 ? updated[0].id : null;
        setActiveConvId(nextActive);
        if (nextActive) {
          getAiMessages(nextActive, user.id).then((msgs) => setMessages(msgs));
        } else {
          setMessages([]);
        }
      }
      setDeleteConfirmId(null);
      toast.success("Conversation deleted");
    } catch {
      toast.error("Failed to delete conversation");
    }
  };

  // ─── Copy to Clipboard ─────────────────────────────────────────
  const handleCopy = async (text: string, msgId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(msgId);
      sounds.playClick();
      toast.success("Copied to clipboard");
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch {
      toast.error("Could not copy text");
    }
  };

  // ─── Keyboard Handling ─────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") {
      textareaRef.current?.blur();
    }
  };

  const hasConversation = messages.length > 0;
  const filteredConversations = conversations.filter((c) =>
    (c.title || "Health Chat").toLowerCase().includes(historySearch.toLowerCase()),
  );

  return (
    <Screen fullHeight noBottomPadding contentClassName="px-3 sm:px-5">
      {/* ════════════════════════════════════════════════════════════
          APP HEADER — Fixed Top Bar
          ════════════════════════════════════════════════════════════ */}
      <header className="flex items-center justify-between pb-3 border-b border-border/40 shrink-0">
        <Link to="/profile" className="flex items-center gap-2.5 group">
          <UserAvatar
            name={user?.full_name}
            src={user?.avatar_url}
            alt={user?.full_name || "User profile"}
            className="size-9 sm:size-10 rounded-full border-2 border-primary/30 shadow-xs group-hover:scale-105 transition-transform"
            initialsClassName="text-xs"
          />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm sm:text-base font-extrabold text-foreground tracking-tight">
                AI Assistant
              </span>
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            </div>
            <p className="text-[11px] font-medium text-muted-foreground">
              {getGreeting()}, {user?.full_name?.split(" ")[0] || "Friend"}
            </p>
          </div>
        </Link>

        <div className="flex items-center gap-1.5">
          {/* Search Button */}
          <button
            onClick={() => {
              sounds.playNavClick();
              setSearchOpen(true);
            }}
            aria-label="Search"
            title="Global Search"
            className="tap flex size-9 items-center justify-center rounded-full bg-white shadow-xs border border-border/60 hover:bg-accent active:scale-95 text-foreground"
          >
            <Search className="size-4" />
          </button>

          {/* Chat History Modal Button */}
          <button
            onClick={() => {
              sounds.playNavClick();
              setHistoryModalOpen(true);
            }}
            aria-label="Conversation History"
            title="Chat History"
            className="tap relative flex size-9 items-center justify-center rounded-full bg-white shadow-xs border border-border/60 hover:bg-accent active:scale-95 text-foreground"
          >
            <History className="size-4" />
            {conversations.length > 1 && (
              <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-[#7C5CFC] text-[9px] font-bold text-white shadow-xs">
                {conversations.length}
              </span>
            )}
          </button>

          {/* New Chat Button */}
          <button
            onClick={() => {
              sounds.playActionClick();
              handleNewChat();
            }}
            aria-label="New Conversation"
            title="New Chat"
            className="tap flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-[#7C5CFC] to-[#906FFA] shadow-sm text-white hover:opacity-95 active:scale-95"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </header>

      {/* ════════════════════════════════════════════════════════════
          MAIN CONTENT AREA (Scrollable messages & empty state)
          ════════════════════════════════════════════════════════════ */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-3 px-1 space-y-4 scroll-smooth"
        role="log"
        aria-label="Chat conversation"
        aria-live="polite"
      >
        {!hasConversation ? (
          /* Empty / Welcome State */
          <div className="space-y-4 pt-1 pb-4">
            {/* Welcome Banner */}
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              className="rounded-3xl bg-gradient-to-br from-[#EAE6FF] via-[#F4F1FF] to-[#FAF8FF] p-4 sm:p-5 border border-[#7C5CFC]/20 shadow-xs relative overflow-hidden"
            >
              <div className="flex items-center justify-between gap-3 relative z-10">
                <div className="max-w-[70%]">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-[11px] font-black text-[#7C5CFC] shadow-xs">
                    <Bot className="size-3 text-[#7C5CFC]" /> Personal Health AI
                  </span>
                  <h2 className="mt-2 text-base sm:text-lg font-black text-[#12131A] tracking-tight">
                    How can I assist your health today?
                  </h2>
                  <p className="mt-1 text-xs font-medium text-[#6B7280] leading-relaxed">
                    Ask about your medications, doctor visits, health history, or daily routines.
                  </p>
                </div>
                <img
                  src="/illustration/ai-robot.png"
                  alt="AI Assistant"
                  className="h-20 w-20 sm:h-24 sm:w-24 object-contain shrink-0 drop-shadow-[0_8px_16px_rgba(124,92,252,0.25)]"
                />
              </div>
            </motion.div>

            {/* Quick Action Prompt Cards */}
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 px-1">
                Suggested Actions
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {quickActions.map((action, idx) => (
                  <motion.button
                    key={action.title}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: idx * 0.05 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      sounds.playCardClick();
                      handleSend(action.prompt);
                    }}
                    className={cn(
                      "tap group flex items-start gap-3 rounded-2xl border bg-card p-3.5 text-left shadow-xs hover:shadow-md hover:border-[#7C5CFC]/30 transition-all",
                    )}
                  >
                    <div
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br transition-transform group-hover:scale-105",
                        action.color,
                      )}
                    >
                      <action.icon className="size-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-foreground group-hover:text-[#7C5CFC] transition-colors">
                          {action.title}
                        </span>
                        <ChevronRight className="size-3.5 text-muted-foreground/60 group-hover:translate-x-0.5 transition-transform" />
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug line-clamp-2">
                        {action.desc}
                      </p>
                    </div>
                  </motion.button>
                ))}
              </div>
            </div>

            {/* Starter Prompt Chips */}
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 px-1">
                Quick Questions
              </p>
              <div className="flex flex-wrap gap-2">
                {suggestedPrompts.map((prompt) => (
                  <button
                    key={prompt.label}
                    onClick={() => {
                      sounds.playClick();
                      handleSend(prompt.label);
                    }}
                    className="tap inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-white px-3.5 py-1.5 text-xs font-semibold text-foreground/85 shadow-2xs hover:bg-slate-50 hover:border-[#7C5CFC]/40 transition-all active:scale-95"
                  >
                    <prompt.icon className="size-3.5 text-[#7C5CFC]" />
                    <span>{prompt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Active Messages Thread */
          <div className="space-y-4">
            <AnimatePresence initial={false}>
              {messages.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className={cn(
                    "flex items-start gap-2.5",
                    m.role === "user" ? "flex-row-reverse" : "",
                  )}
                >
                  {/* Avatar */}
                  <div
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold shadow-xs",
                      m.role === "user" ? "bg-slate-900 text-white" : "bg-[#7C5CFC]/15 text-[#7C5CFC]",
                    )}
                  >
                    {m.role === "user" ? (
                      <UserIcon className="size-4" />
                    ) : (
                      <Bot className="size-4" />
                    )}
                  </div>

                  {/* Message Bubble */}
                  <div
                    className={cn(
                      "relative max-w-[88%] sm:max-w-[82%] px-4 py-3 text-[13.5px] leading-relaxed shadow-xs",
                      m.role === "user"
                        ? "bg-slate-900 text-white rounded-3xl rounded-tr-sm"
                        : "bg-white border border-[#7C5CFC]/15 text-foreground rounded-3xl rounded-tl-sm",
                    )}
                  >
                    {m.role === "assistant" ? (
                      <div>
                        <MarkdownContent content={m.content} />

                        {/* Copy & Status Bar */}
                        <div className="mt-2.5 pt-2 flex items-center justify-between border-t border-border/40 text-[10.5px] text-muted-foreground">
                          <span className="font-medium">LifeHub Assistant</span>
                          <button
                            onClick={() => handleCopy(m.content, m.id)}
                            className="flex items-center gap-1 rounded-md px-2 py-0.5 font-semibold text-[#7C5CFC] hover:bg-[#7C5CFC]/10 transition-colors"
                            aria-label="Copy message"
                          >
                            {copiedMessageId === m.id ? (
                              <>
                                <Check className="size-3 text-emerald-500" />
                                <span className="text-emerald-500">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="size-3" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="whitespace-pre-line leading-relaxed">{m.content}</p>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Typing indicator */}
            <AnimatePresence>
              {loading && <TypingIndicator onStop={handleStop} />}
            </AnimatePresence>

            {/* Follow-up Suggestion Chips (after last assistant reply when not loading) */}
            {!loading && messages.length > 0 && messages[messages.length - 1].role === "assistant" && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="pt-2 pl-10 flex flex-wrap gap-1.5"
              >
                {defaultFollowUps.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => {
                      sounds.playClick();
                      handleSend(prompt);
                    }}
                    className="tap inline-flex items-center gap-1 rounded-full border border-[#7C5CFC]/25 bg-white/90 px-3 py-1 text-[11.5px] font-medium text-[#7C5CFC] hover:bg-[#7C5CFC]/10 active:scale-95 transition-all shadow-2xs"
                  >
                    <Zap className="size-3" />
                    <span>{prompt}</span>
                  </button>
                ))}
              </motion.div>
            )}

            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      {/* Floating Jump to Bottom Button */}
      <AnimatePresence>
        {showScrollBottom && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 10 }}
            onClick={() => {
              sounds.playClick();
              scrollToBottom(true);
            }}
            className="absolute right-6 bottom-28 z-20 flex size-9 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg border border-white/20 active:scale-95"
            aria-label="Scroll to bottom"
          >
            <ArrowDown className="size-4" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* ════════════════════════════════════════════════════════════
          BOTTOM INPUT DOCK — Responsive, Keyboard & Nav Aware
          ════════════════════════════════════════════════════════════ */}
      <div
        className={cn(
          "w-full shrink-0 transition-all duration-200",
          isKeyboardOpen ? "pb-2 pt-1" : "pb-24 pt-2",
        )}
      >
        <div className="flex items-end gap-2 rounded-3xl border border-border/80 bg-white px-3.5 py-2 shadow-[0_8px_24px_-8px_rgba(18,19,26,0.12)] focus-within:border-[#7C5CFC] focus-within:ring-2 focus-within:ring-[#7C5CFC]/20 transition-all duration-200">
          <textarea
            ref={textareaRef}
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything about medications, vitals, appointments..."
            rows={1}
            aria-label="Message input"
            style={{ fontSize: "16px" }}
            className="flex-1 resize-none bg-transparent py-1.5 text-base sm:text-[15px] text-foreground outline-none placeholder:text-muted-foreground leading-relaxed max-h-[140px]"
          />

          {/* Clear Button */}
          {inputPrompt.length > 0 && (
            <button
              onClick={() => {
                setInputPrompt("");
                if (textareaRef.current) {
                  textareaRef.current.style.height = "auto";
                  textareaRef.current.focus();
                }
              }}
              className="tap flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-slate-100 mb-0.5"
              aria-label="Clear input"
            >
              <X className="size-4" />
            </button>
          )}

          {/* Send / Stop Button */}
          {loading ? (
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={handleStop}
              aria-label="Stop generation"
              className="tap flex size-9 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-md hover:bg-slate-800 transition-all"
            >
              <Square className="size-3.5 fill-current" />
            </motion.button>
          ) : (
            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => {
                sounds.playActionClick();
                handleSend();
              }}
              disabled={!inputPrompt.trim()}
              aria-label="Send message"
              className={cn(
                "tap flex size-9 shrink-0 items-center justify-center rounded-2xl transition-all shadow-md",
                inputPrompt.trim()
                  ? "bg-gradient-to-br from-[#7C5CFC] to-[#906FFA] text-white hover:opacity-95 shadow-[#7C5CFC]/30"
                  : "bg-muted text-muted-foreground opacity-40 cursor-not-allowed",
              )}
            >
              <Send className="size-4" />
            </motion.button>
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════
          CONVERSATION HISTORY MODAL (Rich Sheet)
          ════════════════════════════════════════════════════════════ */}
      <Modal
        open={historyModalOpen}
        onClose={() => setHistoryModalOpen(false)}
        className="p-5 max-w-md bg-white rounded-3xl"
      >
        <div className="flex items-center justify-between pb-3 border-b border-border/40">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-full bg-[#7C5CFC]/15 text-[#7C5CFC]">
              <History className="size-4" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-foreground">Chat History</h3>
              <p className="text-xs text-muted-foreground">{conversations.length} conversations</p>
            </div>
          </div>

          <button
            onClick={() => setHistoryModalOpen(false)}
            className="flex size-8 items-center justify-center rounded-full hover:bg-slate-100 text-muted-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Start New Chat CTA */}
        <div className="mt-3">
          <button
            onClick={() => {
              sounds.playActionClick();
              handleNewChat();
            }}
            className="tap w-full flex items-center justify-center gap-2 rounded-2xl bg-[#7C5CFC] py-2.5 text-xs font-bold text-white shadow-xs hover:bg-[#6C4CE8] transition-colors"
          >
            <Plus className="size-4" />
            Start New Conversation
          </button>
        </div>

        {/* Search Input */}
        {conversations.length > 3 && (
          <div className="mt-3 relative">
            <Search className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
            <input
              type="text"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Search previous chats..."
              className="w-full rounded-xl bg-slate-50 border border-slate-200/80 pl-8 pr-3 py-1.5 text-xs text-foreground outline-none focus:border-[#7C5CFC]"
            />
          </div>
        )}

        {/* Conversations List */}
        <div className="mt-3 max-h-64 overflow-y-auto space-y-1.5 pr-0.5">
          {filteredConversations.map((conv) => {
            const isActive = conv.id === activeConvId;
            return (
              <div
                key={conv.id}
                className={cn(
                  "group flex items-center justify-between rounded-2xl p-2.5 transition-all border",
                  isActive
                    ? "bg-[#7C5CFC]/10 border-[#7C5CFC]/30 text-foreground font-semibold"
                    : "bg-card border-border/40 hover:bg-slate-50 text-foreground/80",
                )}
              >
                <button
                  onClick={() => {
                    sounds.playClick();
                    setActiveConvId(conv.id);
                    setHistoryModalOpen(false);
                  }}
                  className="flex-1 flex items-center gap-2.5 text-left min-w-0"
                >
                  <MessageSquare
                    className={cn(
                      "size-4 shrink-0",
                      isActive ? "text-[#7C5CFC]" : "text-muted-foreground",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold truncate">
                      {conv.title || "Health Chat"}
                    </p>
                    <p className="text-[10.5px] text-muted-foreground">
                      {conv.created_at
                        ? new Date(conv.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        : "Recent"}
                    </p>
                  </div>
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteConfirmId(conv.id);
                  }}
                  className="tap flex size-8 items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  aria-label="Delete conversation"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}

          {filteredConversations.length === 0 && (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No conversations found
            </div>
          )}
        </div>
      </Modal>

      {/* ════════════════════════════════════════════════════════════
          DELETE CONFIRMATION MODAL
          ════════════════════════════════════════════════════════════ */}
      <Modal
        open={Boolean(deleteConfirmId)}
        onClose={() => setDeleteConfirmId(null)}
        className="p-5 max-w-sm bg-white rounded-3xl"
      >
        <div className="text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-3">
            <Trash2 className="size-6" />
          </div>
          <h3 className="text-base font-extrabold text-foreground">Delete Conversation?</h3>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            This will permanently remove this chat history. This action cannot be undone.
          </p>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              onClick={() => setDeleteConfirmId(null)}
              className="tap flex-1 rounded-xl border border-border px-3 py-2 text-xs font-bold text-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={() => deleteConfirmId && handleDeleteChat(deleteConfirmId)}
              className="tap flex-1 rounded-xl bg-destructive px-3 py-2 text-xs font-bold text-destructive-foreground hover:bg-destructive/90 shadow-xs"
            >
              Delete
            </button>
          </div>
        </div>
      </Modal>

      {/* Global Search Modal */}
      {user && (
        <GlobalSearchModal
          isOpen={searchOpen}
          onClose={() => setSearchOpen(false)}
          userId={user.id}
        />
      )}
    </Screen>
  );
}
