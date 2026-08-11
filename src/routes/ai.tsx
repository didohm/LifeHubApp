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
  Loader2,
  Copy,
  Leaf,
  Search,
  ScrollText,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Screen } from "@/components/lifehub/Screen";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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

// ─── Quick Action Cards ──────────────────────────────────────────────
const quickActions = [
  {
    icon: Pill,
    title: "Explain My Medications",
    desc: "Dosage, schedule & interactions",
    prompt: "Walk me through my current medication schedule — what I should take and when.",
    bg: "bg-sky",
  },
  {
    icon: Calendar,
    title: "Prepare for Appointment",
    desc: "Questions & documents to bring",
    prompt: "I have an upcoming doctor appointment. Help me prepare what to ask and bring.",
    bg: "bg-tangerine",
  },
  {
    icon: ScrollText,
    title: "Summarize My Records",
    desc: "Overview of your health data",
    prompt: "Summarize all my health records — medications, appointments, and recent activity.",
    bg: "bg-lavender-soft",
  },
  {
    icon: Leaf,
    title: "Healthy Lifestyle Tips",
    desc: "Simple daily wellness advice",
    prompt: "Give me one simple wellness tip I can act on today.",
    bg: "bg-mint",
  },
];

// ─── Suggested Prompts (compact chips) ───────────────────────────────
const suggestedPrompts = [
  { icon: Pill, label: "What medications do I have today?" },
  { icon: FileText, label: "Explain my blood test" },
  { icon: Calendar, label: "Prepare me for my doctor visit" },
  { icon: ScrollText, label: "Summarize my records" },
];

// ─── Helper: Time-based greeting ─────────────────────────────────────
function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ─── Markdown Renderer (Lightweight) ─────────────────────────────────
function MarkdownContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];

  const flushCodeBlock = (key: number) => {
    if (codeLines.length > 0) {
      elements.push(
        <pre
          key={key}
          className="my-2 overflow-x-auto rounded-xl bg-muted p-3 text-xs leading-relaxed"
        >
          <code>{codeLines.join("\n")}</code>
        </pre>,
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
      elements.push(<div key={`p-${i}`} className="h-2" />);
      continue;
    }

    if (line.startsWith("|") && line.endsWith("|")) {
      const cells = line.split("|").filter(Boolean);
      if (i + 1 < lines.length && lines[i + 1].match(/^[\s|:-]+$/)) {
        const headerCells = cells.map((c, ci) => (
          <th key={ci} className="px-3 py-1.5 text-left text-xs font-semibold">
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
              <td key={ci} className="px-3 py-1.5">
                {c.trim()}
              </td>
            ));
          rows.push(<tr key={`tr-${i}`}>{rowCells}</tr>);
        }
        elements.push(
          <table key={`tbl-${i}`} className="my-2 w-full border-collapse rounded-xl text-xs">
            <thead>
              <tr className="border-b border-border/50 bg-muted/50">{headerCells}</tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>,
        );
        continue;
      }
    }

    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={i} className="mt-3 mb-1 text-sm font-bold">
          {renderInline(line.slice(4))}
        </h3>,
      );
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(
        <h2 key={i} className="mt-4 mb-1.5 text-base font-bold">
          {renderInline(line.slice(3))}
        </h2>,
      );
      continue;
    }
    if (line.startsWith("# ")) {
      elements.push(
        <h1 key={i} className="mt-4 mb-2 text-lg font-bold">
          {renderInline(line.slice(2))}
        </h1>,
      );
      continue;
    }

    if (line.match(/^[\s]*[-*+]\s/)) {
      const indent = line.match(/^[\s]*/)?.[0].length || 0;
      const text = line.replace(/^[\s]*[-*+]\s/, "");
      elements.push(
        <div key={i} className="flex gap-2 pl-3" style={{ paddingLeft: `${indent + 12}px` }}>
          <span className="mt-0.5 text-muted-foreground">•</span>
          <span>{renderInline(text)}</span>
        </div>,
      );
      continue;
    }

    if (line.match(/^\d+[.)]\s/)) {
      const match = line.match(/^(\d+[.)])\s/);
      const text = line.replace(/^\d+[.)]\s/, "");
      elements.push(
        <div key={i} className="flex gap-2 pl-3">
          <span className="mt-0.5 shrink-0 text-muted-foreground">{match?.[1]}</span>
          <span>{renderInline(text)}</span>
        </div>,
      );
      continue;
    }

    if (line.startsWith("> ")) {
      elements.push(
        <blockquote
          key={i}
          className="my-1 border-l-2 border-primary pl-3 text-muted-foreground italic"
        >
          {renderInline(line.slice(2))}
        </blockquote>,
      );
      continue;
    }

    elements.push(
      <p key={i} className="leading-relaxed">
        {renderInline(line)}
      </p>,
    );
  }

  if (inCodeBlock && codeLines.length > 0) {
    flushCodeBlock(lines.length);
  }

  return <div className="space-y-0.5">{elements}</div>;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    const italicParts = part.split(/(_[^_]+_)/g);
    return italicParts.map((ip, j) => {
      if (ip.startsWith("_") && ip.endsWith("_")) {
        return <em key={`${i}-${j}`}>{ip.slice(1, -1)}</em>;
      }
      return ip;
    });
  });
}

// ─── Typing Indicator ────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-card shadow-sm">
        <Bot className="size-4" />
      </div>
      <div className="flex items-center gap-3 rounded-2xl rounded-tl-md bg-card border border-border/30 px-4 py-3.5 text-xs text-muted-foreground shadow-sm">
        <span className="flex gap-1">
          <span
            className="size-1.5 animate-bounce rounded-full bg-ink/40"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="size-1.5 animate-bounce rounded-full bg-ink/40"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="size-1.5 animate-bounce rounded-full bg-ink/40"
            style={{ animationDelay: "300ms" }}
          />
        </span>
        <span className="text-[11px] font-medium text-muted-foreground">Thinking...</span>
      </div>
    </div>
  );
}

// ─── Main Page Component ────────────────────────────────────────────
function AiPage() {
  const { user, firebaseUser, loading: authLoading } = useAuth();
  useAuthGuard(user, authLoading);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [inputPrompt, setInputPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

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
      getAiMessages(activeConvId, user.id).then((msgs) => setMessages(msgs));
    }
  }, [activeConvId, user]);

  // Scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
    }
  }, [inputPrompt]);

  // ─── Send Message ──────────────────────────────────────────────
  const handleSend = async (customPrompt?: string) => {
    const promptToSend = customPrompt || inputPrompt.trim();
    if (!promptToSend || !user || !activeConvId) return;

    setInputPrompt("");
    setLoading(true);
    setStreamingText("");

    try {
      const userMsg = await addAiMessage(activeConvId, "user", promptToSend, user.id);
      setMessages((prev) => [...prev, userMsg]);

      // Firebase ID token authenticates the server-side model proxy.
      // Missing/expired token → assistant gracefully uses the built-in engine.
      const idToken = firebaseUser
        ? await firebaseUser.getIdToken().catch(() => undefined)
        : undefined;

      const replyText = await generateAssistantReply({
        prompt: promptToSend,
        userId: user.id,
        idToken,
        conversationHistory: [...messages, userMsg].map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        })),
      });

      // Streaming effect
      const words = replyText.split(" ");
      let revealed = "";
      for (let i = 0; i < words.length; i++) {
        revealed += (i === 0 ? "" : " ") + words[i];
        setStreamingText(revealed);
        if (words.length > 5) await new Promise((r) => setTimeout(r, 12));
      }

      const aiMsg = await addAiMessage(activeConvId, "assistant", replyText, user.id);
      setMessages((prev) => [...prev, aiMsg]);
      setStreamingText("");
    } catch {
      toast.error("Couldn't get a response right now. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ─── New Conversation ──────────────────────────────────────────
  const handleNewChat = async () => {
    if (!user) return;
    const newConv = await createAiConversation(user.id, "Health Chat");
    setConversations((prev) => [newConv, ...prev]);
    setActiveConvId(newConv.id);
    setMessages([]);
    toast.success("New conversation started");
  };

  // ─── Delete Conversation ───────────────────────────────────────
  // Guards against repeated taps on the same conversation's delete button:
  // repeat taps on an already-deleting conversation are ignored, and the
  // success toast uses a per-conversation id so only ONE notification shows.
  const deletingConvs = useRef<Set<string>>(new Set());
  const handleDeleteChat = async (id: string) => {
    if (!user) return;
    if (deletingConvs.current.has(id)) return; // already deleting this conversation
    deletingConvs.current.add(id);
    try {
      await deleteAiConversation(id, user.id);
      const updated = conversations.filter((c) => c.id !== id);
      setConversations(updated);
      if (activeConvId === id) {
        setActiveConvId(updated.length > 0 ? updated[0].id : null);
        if (updated.length > 0) {
          getAiMessages(updated[0].id, user.id).then((msgs) => setMessages(msgs));
        } else {
          setMessages([]);
        }
      }
      toast.success("Conversation cleared", { id: `conv-cleared-${id}` });
    } catch (err) {
      toast.error("Failed to clear conversation", { id: `conv-clear-error-${id}` });
    } finally {
      deletingConvs.current.delete(id);
    }
  };

  // ─── Copy to Clipboard ─────────────────────────────────────────
  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy text");
    }
  };

  // ─── Keyboard Handling ─────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") {
      textareaRef.current?.blur();
    }
  };

  const hasConversation = messages.length > 0 || streamingText;

  const focusRing =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

  // ─── Render ────────────────────────────────────────────────────
  return (
    <Screen>
      {/* ════════════════════════════════════════════════════════════
          GREETING — matches home page header pattern
          ════════════════════════════════════════════════════════════ */}
      <header className="flex items-center justify-between">
        <Link to="/profile" className="flex items-center gap-3 group">
          <UserAvatar
            name={user?.full_name}
            src={user?.avatar_url}
            alt={user?.full_name || "User profile"}
            className="size-11 rounded-full border-2 border-primary/30 shadow-sm group-hover:scale-105 transition-transform"
            initialsClassName="text-xs"
          />
          <div>
            <p className="text-base font-extrabold text-foreground flex items-center gap-1">
              {getGreeting()}, {user?.full_name?.split(" ")[0] || "Friend"}
            </p>
            <p className="text-xs font-semibold text-muted-foreground">
              {new Date().toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              sounds.playNavClick();
              setSearchOpen(true);
            }}
            aria-label="Search"
            title="Global Search"
            className="tap flex size-10 items-center justify-center rounded-full bg-card shadow-sm border border-border/40 hover:bg-accent active:scale-95"
          >
            <Search className="size-4.5" />
          </button>
        </div>
      </header>

      {/* ════════════════════════════════════════════════════════════
          QUICK ACTIONS + PROMPT CHIPS (empty state only)
          ════════════════════════════════════════════════════════════ */}
      {!hasConversation && (
        <>
          {/* Welcome Banner with Transparent AI Robot Illustration */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="mt-4 rounded-2xl bg-gradient-to-r from-[#E8E2FF]/80 to-[#F5F3FF]/80 p-4 border border-[#7C5CFC]/15 shadow-xs"
          >
            <div className="flex items-center justify-between">
              <div className="max-w-[65%]">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-0.5 text-[10px] font-extrabold text-[#7C5CFC]">
                  ✨ Personal Health Assistant
                </span>
                <h2 className="mt-1.5 text-sm font-black text-[#12131A]">
                  How can I help you today?
                </h2>
                <p className="mt-0.5 text-[11px] font-medium text-[#6B7280]">
                  Ask about medications, prepare for appointments, or explore your health history.
                </p>
              </div>
              <img
                src="/illustration/ai-robot.png"
                alt="AI Assistant"
                className="h-20 w-20 object-contain shrink-0 drop-shadow-[0_8px_16px_rgba(124,92,252,0.25)]"
              />
            </div>
            {/* New Chat button integrated into the card */}
            <div className="mt-3">
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  sounds.playActionClick();
                  handleNewChat();
                }}
                className={cn(
                  "tap flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[11px] font-bold text-card shadow-sm hover:opacity-90 transition-opacity",
                  focusRing,
                )}
              >
                <Plus className="size-3.5" />
                New Chat
              </motion.button>
            </div>
          </motion.div>
          {/* 4 Quick Action Cards — 2x2 grid */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="mt-4 grid grid-cols-2 gap-2.5"
          >
            {quickActions.map((action, idx) => (
              <motion.button
                key={action.title}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.15 + idx * 0.05 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => {
                  sounds.playCardClick();
                  handleSend(action.prompt);
                }}
                className={cn(
                  "tap group flex flex-col items-start gap-2.5 rounded-2xl border border-border/40 bg-card p-3.5 text-left shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all",
                  focusRing,
                )}
              >
                <div
                  className={cn(
                    "flex size-9 items-center justify-center rounded-xl transition-transform group-hover:scale-105",
                    action.bg,
                  )}
                >
                  <action.icon className="size-4 text-ink" />
                </div>
                <div>
                  <div className="text-xs font-bold leading-tight text-foreground">
                    {action.title}
                  </div>
                  <div className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground line-clamp-2">
                    {action.desc}
                  </div>
                </div>
              </motion.button>
            ))}
          </motion.div>

          {/* Suggested Prompt Chips — compact */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.35 }}
            className="mt-3 flex flex-wrap gap-2"
          >
            {suggestedPrompts.map((prompt) => (
              <motion.button
                key={prompt.label}
                whileTap={{ scale: 0.96 }}
                onClick={() => {
                  sounds.playCardClick();
                  handleSend(prompt.label);
                }}
                className={cn(
                  "tap inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-card px-3.5 py-1.5 text-[11px] font-semibold text-foreground/80 shadow-sm hover:bg-accent hover:text-foreground hover:border-border transition-colors",
                  focusRing,
                )}
              >
                <prompt.icon className="size-3.5 text-primary" />
                {prompt.label}
              </motion.button>
            ))}
          </motion.div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════
          CONVERSATION AREA — the primary focus
          ════════════════════════════════════════════════════════════ */}
      {hasConversation && (
        <div className="mt-4">
          {/* Conversation header bar */}
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-extrabold text-foreground flex items-center gap-2">
              <MessageSquare className="size-4 text-primary" /> Conversation
            </h2>
            <div className="flex items-center gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="Conversation history"
                    className={cn(
                      "tap flex size-9 items-center justify-center rounded-full bg-card shadow-sm border border-border/40 text-muted-foreground hover:bg-accent transition-colors",
                      focusRing,
                    )}
                  >
                    <MessageSquare className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-2 py-1.5 text-[11px] font-semibold text-muted-foreground">
                    Recent conversations
                  </div>
                  {conversations.slice(0, 5).map((conv) => (
                    <DropdownMenuItem
                      key={conv.id}
                      onClick={() => {
                        sounds.playClick();
                        setActiveConvId(conv.id);
                        if (user) getAiMessages(conv.id, user.id).then((msgs) => setMessages(msgs));
                      }}
                      className={cn(
                        "cursor-pointer text-xs",
                        conv.id === activeConvId && "bg-accent text-foreground font-semibold",
                      )}
                    >
                      <MessageSquare className="mr-2 size-3.5" />
                      <span className="truncate">{conv.title || "Health Chat"}</span>
                    </DropdownMenuItem>
                  ))}
                  {conversations.length === 0 && (
                    <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                      No previous conversations
                    </div>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      sounds.playActionClick();
                      handleNewChat();
                    }}
                    className="cursor-pointer text-xs font-medium text-foreground"
                  >
                    <Plus className="mr-2 size-3.5" />
                    New conversation
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {activeConvId && (
                <button
                  onClick={() => {
                    sounds.playActionClick();
                    handleDeleteChat(activeConvId);
                  }}
                  aria-label="Delete conversation"
                  className={cn(
                    "tap flex size-9 items-center justify-center rounded-full bg-card shadow-sm border border-border/40 text-destructive hover:bg-destructive/10 transition-colors",
                    focusRing,
                  )}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          </div>

          {/* Chat Messages */}
          <div
            className="flex flex-col gap-3 pr-0.5 overflow-y-auto max-h-[calc(100dvh-22rem)] scroll-smooth"
            role="log"
            aria-label="Chat messages"
            aria-live="polite"
          >
            <AnimatePresence initial={false}>
              {messages.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className={cn(
                    "flex items-start gap-3",
                    m.role === "user" ? "flex-row-reverse" : "",
                  )}
                >
                  {/* Avatar */}
                  <div
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold shadow-sm",
                      m.role === "user" ? "bg-ink text-card" : "bg-lavender text-ink",
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
                      "relative max-w-[85%] p-4 text-xs leading-relaxed shadow-sm",
                      m.role === "user"
                        ? "bg-ink text-card rounded-3xl rounded-tr-md"
                        : "card-soft bg-card border border-border/30 text-foreground rounded-3xl rounded-tl-md",
                    )}
                  >
                    {m.role === "assistant" ? (
                      <MarkdownContent content={m.content} />
                    ) : (
                      <p className="whitespace-pre-line">{m.content}</p>
                    )}

                    {/* Message actions (assistant only) */}
                    {m.role === "assistant" && (
                      <div className="mt-3 flex items-center gap-2 border-t border-border/20 pt-2.5">
                        <button
                          onClick={() => {
                            sounds.playClick();
                            handleCopy(m.content);
                          }}
                          className={cn(
                            "inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors",
                            focusRing,
                          )}
                          aria-label="Copy message"
                        >
                          <Copy className="size-3" />
                          Copy
                        </button>

                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Streaming message */}
            <AnimatePresence>
              {streamingText && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-start gap-3"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-lavender text-ink shadow-sm">
                    <Bot className="size-4" />
                  </div>
                  <div className="card-soft max-w-[85%] bg-card border border-border/30 p-4 text-xs leading-relaxed shadow-sm text-foreground">
                    <MarkdownContent content={streamingText} />
                    <motion.span
                      animate={{ opacity: [1, 0.3] }}
                      transition={{ duration: 0.8, repeat: Infinity }}
                      className="inline-block ml-0.5 size-1.5 rounded-full bg-ink"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Typing indicator */}
            <AnimatePresence>{loading && !streamingText && <TypingIndicator />}</AnimatePresence>

            <div ref={chatEndRef} />
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          MESSAGE INPUT — sticky above the floating nav
          ════════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2 }}
        className={cn(
          "sticky bottom-24 z-10 -mx-5 mt-4 px-5 pb-2",
          "bg-gradient-to-t from-[#F7F7FA] via-[#F7F7FA]/95 to-transparent",
        )}
      >
        <div
          className={cn(
            "flex items-end gap-2 rounded-3xl border border-border/50 bg-card px-4 py-2.5 shadow-[0_8px_24px_-8px_rgba(18,19,26,0.15)] focus-within:border-ring focus-within:shadow-md focus-within:shadow-ring/10 transition-all duration-200",
          )}
        >
          <textarea
            ref={textareaRef}
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about medications, appointments, bills..."
            rows={1}
            aria-label="Message input"
            className="flex-1 resize-none bg-transparent py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground leading-relaxed max-h-[120px]"
            style={{ scrollbarWidth: "thin" }}
            disabled={loading}
          />

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => {
              sounds.playActionClick();
              handleSend();
            }}
            disabled={loading || !inputPrompt.trim()}
            aria-label="Send message"
            className={cn(
              "tap flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#7C5CFC] to-[#A78BFA] text-white shadow-md transition-all",
              focusRing,
              loading || !inputPrompt.trim()
                ? "opacity-40 cursor-not-allowed"
                : "hover:shadow-lg hover:opacity-90 active:shadow-sm",
            )}
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </motion.button>
        </div>
      </motion.div>

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
