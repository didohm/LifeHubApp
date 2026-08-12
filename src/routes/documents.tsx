import { useState, useEffect, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
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
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { Screen } from "@/components/lifehub/Screen";
import { Modal } from "@/components/lifehub/Modal";
import { useAuth } from "@/hooks/use-auth";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useDeleteWithGuard } from "@/hooks/use-delete-with-guard";
import { getDocuments, createDocument, updateDocument, deleteDocument } from "@/lib/api";
import { DocumentItem } from "@/lib/types";
import { generateAssistantReply } from "@/lib/ai-provider";
import { useData } from "@/lib/data-context";
import { ListSkeleton } from "@/components/lifehub/SkeletonLoader";
import {
  uploadDocument,
  validateFileType,
  validateFileSize,
  formatFileSize,
} from "@/lib/cloudinary";

// Increased limit from 600KB to 10MB for Cloudinary uploads
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_MIME_PREFIXES = ["image/", "application/pdf", "text/"];

async function processFileUpload(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<{ file_url: string; file_size: string; file_type: string }> {
  // Validate file type
  if (!validateFileType(file, ALLOWED_UPLOAD_MIME_PREFIXES)) {
    throw new Error("Unsupported file type. Please upload a PDF, image, or text file.");
  }

  // Validate file size
  if (!validateFileSize(file, MAX_UPLOAD_BYTES)) {
    throw new Error("File is too large. Please upload a file smaller than 10MB.");
  }

  const fileSize = formatFileSize(file.size);
  const fileType = file.type || "application/octet-stream";

  // Upload to Cloudinary
  const result = await uploadDocument(file, onProgress);

  return {
    file_url: result.secure_url,
    file_size: fileSize,
    file_type: fileType,
  };
}

export const Route = createFileRoute("/documents")({
  head: () => ({
    meta: [{ title: "Documents Vault — LifeHub" }],
  }),
  component: DocumentsPage,
});

function DocumentsPage() {
  const { user, loading: authLoading } = useAuth();
  useAuthGuard(user, authLoading);

  const { documents, docLoading: loading } = useData();

  const [categoryFilter, setCategoryFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

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
  const [uploadProgress, setUploadProgress] = useState(0);

  const { deleteWithGuard } = useDeleteWithGuard();

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
    setUploadProgress(0);

    try {
      if (editingDoc) {
        await updateDocument(editingDoc.id, user.id, {
          name: docName,
          category,
          file_url: editingDoc.file_url,
          file_size: editingDoc.file_size,
          file_type: editingDoc.file_type,
          summary: editingDoc.summary,
        });
        toast.success("Document metadata updated!");
      } else {
        let fileUrl = "";
        let fileSize = "";
        let fileType = "";

        if (selectedFile) {
          const res = await processFileUpload(selectedFile, (progress) => {
            setUploadProgress(progress);
          });
          fileUrl = res.file_url;
          fileSize = res.file_size;
          fileType = res.file_type;
        }

        await createDocument(user.id, {
          name: docName || selectedFile?.name || "Uploaded Document",
          category,
          file_url: fileUrl,
          file_size: fileSize,
          file_type: fileType,
          summary: "",
        });

        toast.success("Document uploaded to Cloudinary!");
      }
      setUploadModalOpen(false);
      setUploadProgress(0);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to upload document.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    await deleteWithGuard(id, async () => {
      await deleteDocument(id, user.id);
      toast.success("Document deleted.", { id: `doc-deleted-${id}` });
    })().catch(() => {
      toast.error("Failed to delete document.", { id: `doc-delete-error-${id}` });
    });
  };

  const handleAiSummarize = async (docItem: DocumentItem) => {
    if (!user) return;

    setSummarizing(true);
    toast.info(`Generating AI insights for ${docItem.name}...`);
    try {
      // Note: This generates AI insights based on document metadata (name, category, upload date)
      // For full content analysis, implement OCR/text extraction from docItem.file_url
      const summary = await generateAssistantReply({
        prompt: `Based on this document metadata, provide helpful context and reminders: 
        - Document name: ${docItem.name}
        - Category: ${docItem.category}
        - Upload date: ${docItem.created_at || 'N/A'}
        
        Generate a brief helpful summary about what this type of document typically contains and what the user should remember about it.`,
        userId: user.id,
      });
      await updateDocument(docItem.id, user.id, { summary });
      setSummaryModalText(summary);
      toast.success("AI insights ready!");
    } catch {
      toast.error("Could not generate AI insights.");
    } finally {
      setSummarizing(false);
    }
  };

  const filteredDocs = documents.filter((d: DocumentItem) => {
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
          filteredDocs.map((docItem: DocumentItem) => (
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
      <Modal open={uploadModalOpen} onClose={() => setUploadModalOpen(false)} className="bg-card">
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
              {submitting && uploadProgress > 0 && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span>Uploading to Cloudinary...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}
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
      </Modal>

      {/* Preview Modal */}
      {previewDoc && (
        <Modal open onClose={() => setPreviewDoc(null)} className="bg-card">
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
            {previewDoc.file_url ? (
              previewDoc.file_url.startsWith("data:image/") ||
              previewDoc.file_url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i) ? (
                <img
                  src={previewDoc.file_url}
                  alt="Document preview"
                  className="max-h-64 rounded-xl object-contain shadow-md"
                />
              ) : previewDoc.file_url.match(/\.pdf(\?.*)?$/i) ? (
                <iframe
                  src={previewDoc.file_url}
                  title="PDF Preview"
                  className="w-full h-64 rounded-xl border border-border"
                />
              ) : (
                <FileText className="size-20 text-muted-foreground/60" />
              )
            ) : (
              <FileText className="size-20 text-muted-foreground/60" />
            )}
            {previewDoc.summary ? (
              <p className="mt-3 text-xs text-muted-foreground leading-relaxed text-center">
                {previewDoc.summary}
              </p>
            ) : null}
            {previewDoc.file_url ? (
              <a
                href={previewDoc.file_url}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-xs font-bold text-foreground hover:bg-accent/80 transition-colors"
              >
                <ExternalLink className="size-3.5" /> View / Download Document
              </a>
            ) : null}
          </div>
        </Modal>
      )}

      {/* AI Summary Modal */}
      <Modal
        open={!!summaryModalText}
        onClose={() => setSummaryModalText(null)}
        className="bg-card"
      >
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
      </Modal>
    </Screen>
  );
}
