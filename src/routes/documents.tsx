import { useState, useEffect, useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  FolderClosed,
  FileText,
  Trash2,
  Eye,
  Wand2,
  Upload,
  Search,
  Edit2,
  X,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Screen } from "@/components/lifehub/Screen";
import { useAuth } from "@/hooks/use-auth";
import { getDocuments, createDocument, updateDocument, deleteDocument } from "@/lib/api";
import { DocumentItem } from "@/lib/types";
import { generateAssistantReply } from "@/lib/ai-provider";
import { ListSkeleton } from "@/components/lifehub/SkeletonLoader";

const MAX_UPLOAD_BYTES = 600 * 1024;
const ALLOWED_UPLOAD_MIME_PREFIXES = ["image/", "application/pdf", "text/"];

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

async function processFileUpload(
  file: File,
): Promise<{ file_url: string; file_size: string; file_type: string }> {
  const isAllowedType = ALLOWED_UPLOAD_MIME_PREFIXES.some((prefix) => file.type.startsWith(prefix));
  if (!isAllowedType) {
    throw new Error("Unsupported file type. Please upload a PDF, image, or text file.");
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("File is too large. Please upload a file smaller than 600KB.");
  }

  const fileSize = formatFileSize(file.size);
  const fileType = file.type || "application/octet-stream";

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        file_url: reader.result as string,
        file_size: fileSize,
        file_type: fileType,
      });
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export const Route = createFileRoute("/documents")({
  head: () => ({
    meta: [{ title: "Documents Vault — LifeHub" }],
  }),
  component: DocumentsPage,
});

function DocumentsPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);

  // Modals
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<DocumentItem | null>(null);
  const [previewDoc, setPreviewDoc] = useState<DocumentItem | null>(null);
  const [summaryModalText, setSummaryModalText] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  const [docName, setDocName] = useState("");
  const [category, setCategory] = useState("Medical");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate({ to: "/auth" });
    }
  }, [user, authLoading, navigate]);

  const loadDocs = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await getDocuments(user.id);
      setDocuments(data);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load documents.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) loadDocs();
  }, [user, loadDocs]);

  const openUploadModal = () => {
    setEditingDoc(null);
    setDocName("");
    setCategory("Medical");
    setSelectedFile(null);
    setUploadModalOpen(true);
  };

  const openEditModal = (docItem: DocumentItem) => {
    setEditingDoc(docItem);
    setDocName(docItem.name);
    setCategory(docItem.category);
    setUploadModalOpen(true);
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);

    try {
      if (editingDoc) {
        const updatedDoc = await updateDocument(editingDoc.id, user.id, {
          name: docName,
          category,
          file_url: editingDoc.file_url,
          file_size: editingDoc.file_size,
          file_type: editingDoc.file_type,
          summary: editingDoc.summary,
        });
        setDocuments((prev) => prev.map((d) => (d.id === editingDoc.id ? updatedDoc : d)));
        toast.success("Document metadata updated!");
      } else {
        let fileUrl = "";
        let fileSize = "";
        let fileType = "";

        if (selectedFile) {
          const res = await processFileUpload(selectedFile);
          fileUrl = res.file_url;
          fileSize = res.file_size;
          fileType = res.file_type;
        }

        const newDoc = await createDocument(user.id, {
          name: docName || selectedFile?.name || "Uploaded Document",
          category,
          file_url: fileUrl,
          file_size: fileSize,
          file_type: fileType,
          summary: "",
        });

        setDocuments((prev) => [newDoc, ...prev]);
        toast.success("Document uploaded to Vault!");
      }
      setUploadModalOpen(false);
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to upload document.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    try {
      await deleteDocument(id, user.id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      toast.success("Document deleted.");
    } catch (err) {
      toast.error("Failed to delete document.");
    }
  };

  const handleAiSummarize = async (docItem: DocumentItem) => {
    if (!user) return;

    setSummarizing(true);
    toast.info(`Summarizing ${docItem.name}...`);
    try {
      const summary = await generateAssistantReply({
        prompt: `Summarise this document for me: ${docItem.name} (${docItem.category}). What are the key takeaways, any important dates, names, or numbers I should know about?`,
        userId: user.id,
      });
      setSummaryModalText(summary);
      toast.success("Summary ready!");
    } catch {
      toast.error("Could not generate summary.");
    } finally {
      setSummarizing(false);
    }
  };

  const filteredDocs = documents.filter((d) => {
    const matchesCat = categoryFilter === "all" ? true : d.category === categoryFilter;
    const matchesSearch = d.name.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <Screen>
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground flex items-center gap-2">
            <FolderClosed className="size-6 text-mint fill-mint/30" /> Document Vault
          </h1>
          <p className="text-xs text-muted-foreground">Secure medical records & prescriptions</p>
        </div>
        <button
          onClick={openUploadModal}
          className="tap flex items-center gap-1 rounded-full bg-ink px-4 py-2 text-xs font-bold text-card shadow-md transition-transform active:scale-95 hover:opacity-90"
        >
          <Upload className="size-4" /> Upload
        </button>
      </header>

      {/* Search & Category Filter */}
      <div className="mt-4 space-y-3">
        <div className="flex items-center gap-2 rounded-2xl border border-border/50 bg-card px-3.5 py-2 text-xs shadow-sm">
          <Search className="size-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search document name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-transparent outline-none"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {["all", "Medical", "Prescription", "Insurance", "Lab Results", "Study"].map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`rounded-full px-3.5 py-1 text-xs font-bold capitalize whitespace-nowrap ${
                categoryFilter === cat
                  ? "bg-slate-900 text-white shadow-sm"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Documents Grid */}
      <div className="mt-4 space-y-3">
        {loading ? (
          <ListSkeleton count={3} />
        ) : filteredDocs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200/60 p-6 text-center bg-card/40">
            <FolderClosed className="mx-auto size-12 text-muted-foreground/50" />
            <p className="mt-2 text-sm font-bold text-foreground">No documents in vault</p>
          </div>
        ) : (
          filteredDocs.map((docItem) => (
            <div
              key={docItem.id}
              className="card-soft bg-card p-4 border border-border/40 shadow-sm flex items-center justify-between transition-all hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <FileText className="size-5" />
                </div>
                <div>
                  <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                    {docItem.category}
                  </span>
                  <h3 className="mt-0.5 text-sm font-extrabold text-foreground">{docItem.name}</h3>
                  <p className="text-[11px] text-muted-foreground">
                    {docItem.file_size || "Unknown size"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPreviewDoc(docItem)}
                  aria-label={`Preview document ${docItem.name}`}
                  title="Preview Document"
                  className="size-8 flex items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Eye className="size-4" />
                </button>
                <button
                  onClick={() => handleAiSummarize(docItem)}
                  aria-label={`Summarize document ${docItem.name}`}
                  title="AI Summarize Document"
                  className="size-8 flex items-center justify-center rounded-full text-purple-600 hover:bg-purple-500/10"
                >
                  <Wand2 className="size-4" />
                </button>
                <button
                  onClick={() => openEditModal(docItem)}
                  aria-label={`Edit metadata for ${docItem.name}`}
                  title="Edit Metadata"
                  className="size-8 flex items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
                >
                  <Edit2 className="size-4" />
                </button>
                <button
                  onClick={() => handleDelete(docItem.id)}
                  aria-label={`Delete document ${docItem.name}`}
                  title="Delete"
                  className="size-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Upload / Edit Modal */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-3xl bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h2 className="text-lg font-extrabold text-foreground">
                {editingDoc ? "Edit Document" : "Upload Document"}
              </h2>
              <button
                onClick={() => setUploadModalOpen(false)}
                className="size-8 flex items-center justify-center rounded-full bg-muted text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-bold text-foreground">Document Title</label>
                <input
                  type="text"
                  required
                  placeholder="Document name"
                  value={docName}
                  onChange={(e) => setDocName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-input bg-muted/30 p-2.5 text-sm outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-foreground">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-input bg-muted/30 p-2.5 text-sm outline-none"
                >
                  <option value="Medical">Medical</option>
                  <option value="Prescription">Prescription</option>
                  <option value="Insurance">Insurance</option>
                  <option value="Lab Results">Lab Results</option>
                  <option value="Study">Study</option>
                </select>
              </div>

              {!editingDoc && (
                <div>
                  <label className="text-xs font-bold text-foreground">Select File</label>
                  <input
                    type="file"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    className="mt-1 w-full rounded-xl border border-input bg-muted/30 p-2 text-xs"
                  />
                </div>
              )}

              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setUploadModalOpen(false)}
                  className="w-1/2 rounded-xl border border-border py-2.5 text-xs font-bold text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-1/2 flex items-center justify-center gap-1.5 rounded-xl bg-ink py-2.5 text-xs font-bold text-card shadow-md disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
                  {submitting ? "Saving..." : "Save Document"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-3xl bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h2 className="text-base font-extrabold text-foreground">{previewDoc.name}</h2>
              <button
                onClick={() => setPreviewDoc(null)}
                className="size-8 flex items-center justify-center rounded-full bg-muted text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-4 flex flex-col items-center">
              {previewDoc.file_url.startsWith("data:image/") ? (
                <img
                  src={previewDoc.file_url}
                  alt="Document preview"
                  className="max-h-64 rounded-xl object-contain shadow-md"
                />
              ) : (
                <FileText className="size-20 text-muted-foreground/60" />
              )}
              <p className="mt-3 text-xs text-muted-foreground leading-relaxed text-center">
                {previewDoc.summary}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* AI Summary Modal */}
      {summaryModalText && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-3xl bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h2 className="text-base font-extrabold text-foreground flex items-center gap-2">
                <Wand2 className="size-4 text-purple-600" /> AI Document Summary
              </h2>
              <button
                onClick={() => setSummaryModalText(null)}
                className="size-8 flex items-center justify-center rounded-full bg-muted text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-4 text-xs leading-relaxed text-foreground whitespace-pre-line max-h-96 overflow-y-auto">
              {summaryModalText}
            </div>
          </div>
        </div>
      )}
    </Screen>
  );
}
