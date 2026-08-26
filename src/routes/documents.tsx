import { useState, useMemo, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  FolderClosed,
  FileText,
  Trash2,
  Eye,
  Upload,
  Search,
  Edit2,
  X,
  Loader2,
  ExternalLink,
  FileCode,
  Image as ImageIcon,
  Shield,
  Clock,
  Plus,
  Filter,
  FileCheck,
  HardDrive,
} from "lucide-react";
import { toast } from "sonner";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { Modal } from "@/components/lifehub/Modal";
import { useAuth } from "@/hooks/use-auth";
import { useDeleteWithGuard } from "@/hooks/use-delete-with-guard";
import { createDocument, updateDocument, deleteDocument } from "@/lib/api";
import { DocumentItem } from "@/lib/types";
import { useData } from "@/lib/data-context";
import { ListSkeleton } from "@/components/lifehub/SkeletonLoader";
import {
  uploadDocument,
  validateFileType,
  validateFileSize,
  formatFileSize,
} from "@/lib/cloudinary";
import { sounds } from "@/lib/sound";
import { cn } from "@/lib/utils";

// Increased limit to 10MB for Cloudinary uploads
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_MIME_PREFIXES = ["image/", "application/pdf", "text/"];

const DOCUMENT_CATEGORIES = [
  "Medical",
  "Prescription",
  "Insurance",
  "Lab Results",
  "ID / Personal",
  "Study / Work",
] as const;

type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number] | "all";

async function processFileUpload(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<{ file_url: string; file_size: string; file_type: string }> {
  if (!validateFileType(file, ALLOWED_UPLOAD_MIME_PREFIXES)) {
    throw new Error("Unsupported file type. Please upload a PDF, image, or text file.");
  }

  if (!validateFileSize(file, MAX_UPLOAD_BYTES)) {
    throw new Error("File is too large. Maximum supported size is 10MB.");
  }

  const fileSize = formatFileSize(file.size);
  const fileType = file.type || "application/octet-stream";

  const result = await uploadDocument(file, onProgress);

  return {
    file_url: result.secure_url,
    file_size: fileSize,
    file_type: fileType,
  };
}

function getFileIcon(fileType?: string | null, fileUrl?: string | null) {
  const type = (fileType || "").toLowerCase();
  const url = (fileUrl || "").toLowerCase();

  if (type.includes("pdf") || url.endsWith(".pdf")) {
    return {
      Icon: FileText,
      color: "text-rose-600 bg-rose-50 border-rose-100",
      badge: "PDF",
    };
  }
  if (
    type.includes("image") ||
    url.match(/\.(jpg|jpeg|png|webp|gif)$/i) ||
    url.startsWith("data:image/")
  ) {
    return {
      Icon: ImageIcon,
      color: "text-amber-600 bg-amber-50 border-amber-100",
      badge: "IMG",
    };
  }
  return {
    Icon: FileCode,
    color: "text-indigo-600 bg-indigo-50 border-indigo-100",
    badge: "DOC",
  };
}

export const Route = createFileRoute("/documents")({
  head: () => ({
    meta: [
      { title: "Documents Vault — LifeHub" },
      {
        name: "description",
        content: "Secure document storage, medical records, prescriptions, IDs & AI analysis.",
      },
    ],
  }),
  component: DocumentsPage,
});

function DocumentsPage() {
  const { user, firebaseUser } = useAuth();

  const { documents, docLoading: loading } = useData();

  const [categoryFilter, setCategoryFilter] = useState<DocumentCategory>("all");
  const [searchTerm, setSearchTerm] = useState("");

  // Modals
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<DocumentItem | null>(null);
  const [previewDoc, setPreviewDoc] = useState<DocumentItem | null>(null);

  // Upload Form State
  const [docName, setDocName] = useState("");
  const [category, setCategory] = useState<string>("Medical");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { deleteWithGuard } = useDeleteWithGuard();

  const resetForm = () => {
    setDocName("");
    setCategory("Medical");
    setSelectedFile(null);
    setFilePreviewUrl(null);
    setUploadProgress(0);
    setEditingDoc(null);
  };

  const openUploadModal = () => {
    sounds.playActionClick();
    resetForm();
    setUploadModalOpen(true);
  };

  const openEditModal = (docItem: DocumentItem) => {
    sounds.playActionClick();
    setEditingDoc(docItem);
    setDocName(docItem.name);
    setCategory(docItem.category || "Medical");
    setUploadModalOpen(true);
  };

  const handleFileSelect = (file: File | null) => {
    if (!file) {
      setSelectedFile(null);
      setFilePreviewUrl(null);
      return;
    }
    sounds.playClick();
    setSelectedFile(file);
    if (!docName) {
      const cleanName = file.name.replace(/\.[^/.]+$/, "");
      setDocName(cleanName);
    }
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => setFilePreviewUrl(e.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setFilePreviewUrl(null);
    }
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
        });
        sounds.playSuccess();
        toast.success("Document updated successfully!");
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
        });

        sounds.playUploadSuccess();
        toast.success("Document securely saved to Vault!");
      }
      setUploadModalOpen(false);
      resetForm();
    } catch (err: any) {
      sounds.playError();
      toast.error(err.message || "Failed to save document.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!user) return;
    await deleteWithGuard(id, async () => {
      await deleteDocument(id, user.id);
      sounds.playClick();
      toast.success(`"${name}" removed from vault.`);
    })().catch(() => {
      sounds.playError();
      toast.error("Failed to delete document.");
    });
  };

  const filteredDocs = useMemo(() => {
    return documents.filter((d: DocumentItem) => {
      const matchesCat = categoryFilter === "all" ? true : d.category === categoryFilter;
      const matchesSearch =
        d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (d.category || "").toLowerCase().includes(searchTerm.toLowerCase());
      return matchesCat && matchesSearch;
    });
  }, [documents, categoryFilter, searchTerm]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: documents.length };
    DOCUMENT_CATEGORIES.forEach((cat) => {
      counts[cat] = documents.filter((d) => d.category === cat).length;
    });
    return counts;
  }, [documents]);

  return (
    <Screen>
      <ScreenHeader
        title="Documents Vault"
        subtitle="Secure records, health files & prescriptions"
        showBack
        action={
          <button
            type="button"
            onClick={openUploadModal}
            className="tap flex items-center gap-1.5 rounded-full bg-[#12131A] px-4 py-2 text-xs font-black text-white shadow-md hover:bg-slate-800 transition-transform active:scale-95"
          >
            <Plus className="size-3.5 stroke-[3]" /> Add Document
          </button>
        }
      />

      {/* ══════════════════════════════════════════════════════════════
          STORAGE VAULT OVERVIEW BANNER
          ══════════════════════════════════════════════════════════════ */}
      <section className="card-soft relative overflow-hidden bg-gradient-to-br from-[#0F1117] via-[#1A1D27] to-[#25293A] p-5 text-white shadow-md mb-4 border border-white/10 rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 text-emerald-400 px-3 py-0.5 text-[11px] font-black uppercase tracking-wider border border-emerald-500/30">
                <Shield className="size-3" /> Encrypted Vault
              </span>
              <span className="text-[11px] text-white/60 font-semibold">10MB Cloud Storage</span>
            </div>

            <h2 className="mt-2.5 text-2xl font-black text-white tracking-tight leading-tight">
              {documents.length} {documents.length === 1 ? "Document" : "Documents"} Stored
            </h2>
            <p className="mt-1 text-xs font-medium text-white/70">
              Access your medical history, prescriptions & ID cards anytime.
            </p>
          </div>

          <div className="flex size-12 items-center justify-center rounded-2xl bg-white/10 text-white shadow-2xs backdrop-blur-md shrink-0 border border-white/10">
            <HardDrive className="size-6 text-emerald-400" />
          </div>
        </div>

        {/* Category Distribution Pills */}
        <div className="mt-4 pt-3.5 border-t border-white/10 flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          <span className="text-[11px] font-black uppercase tracking-wider text-white/50 shrink-0">
            Breakdown:
          </span>
          {DOCUMENT_CATEGORIES.map((cat) => {
            const count = categoryCounts[cat] || 0;
            if (count === 0) return null;
            return (
              <span
                key={cat}
                className="rounded-lg bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white/90 whitespace-nowrap"
              >
                {cat}: {count}
              </span>
            );
          })}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════
          SEARCH & CATEGORY FILTER CHIPS
          ══════════════════════════════════════════════════════════════ */}
      <div className="space-y-3 mb-4">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search documents by name or category..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-2xl border border-border/70 bg-white min-h-[44px] py-3 pl-10 pr-4 text-[16px] sm:text-sm font-semibold text-foreground outline-none shadow-2xs focus:border-[#7C5CFC] transition-all"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              aria-label="Clear search"
              className="tap absolute right-1.5 top-1/2 flex size-10 min-h-[40px] min-w-[40px] -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* Scrollable Category Filter Pills */}
        <div className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-5 px-5">
          {(["all", ...DOCUMENT_CATEGORIES] as DocumentCategory[]).map((cat) => {
            const isSelected = categoryFilter === cat;
            const count = categoryCounts[cat] || 0;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => {
                  sounds.playNavClick();
                  setCategoryFilter(cat);
                }}
                className={cn("tap flex items-center gap-1.5 rounded-full px-4 py-2 min-h-[36px] text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#12131A] font-black capitalize whitespace-nowrap transition-all shadow-2xs",
                  isSelected
                    ? "bg-[#12131A] text-white shadow-xs"
                    : "bg-white text-muted-foreground border border-border/60 hover:bg-slate-50 hover:text-foreground",
                )}
              >
                <span>{cat === "all" ? "All Documents" : cat}</span>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.2 text-[11px] font-black",
                    isSelected ? "bg-white/20 text-white" : "bg-slate-100 text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          DOCUMENTS LIST
          ══════════════════════════════════════════════════════════════ */}
      <div className="space-y-3">
        {loading ? (
          <ListSkeleton count={3} />
        ) : filteredDocs.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-8 text-center shadow-xs">
            <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <FolderClosed className="size-7" />
            </div>
            <p className="text-base font-black text-[#12131A]">
              {searchTerm || categoryFilter !== "all" ? "No matching documents" : "Vault is empty"}
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              {searchTerm || categoryFilter !== "all"
                ? "Try adjusting your search query or switching to another category."
                : "Upload prescriptions, test results, vaccination records, or personal documents to keep them safe."}
            </p>
            <button
              onClick={openUploadModal}
              className="tap mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#12131A] px-5 py-2.5 text-xs font-black text-white shadow-md hover:bg-slate-800 transition-transform active:scale-95"
            >
              <Plus className="size-4 stroke-[3]" /> Upload Document
            </button>
          </div>
        ) : (
          filteredDocs.map((docItem: DocumentItem) => {
            const {
              Icon: FileIconComponent,
              color,
              badge,
            } = getFileIcon(docItem.file_type, docItem.file_url);

            return (
              <div
                key={docItem.id}
                className="card-soft bg-white p-4 border border-black/5 shadow-xs hover:shadow-sm transition-all space-y-3 rounded-2xl"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={cn(
                        "flex size-11 items-center justify-center rounded-2xl border shrink-0 shadow-2xs",
                        color,
                      )}
                    >
                      <FileIconComponent className="size-5" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-700 uppercase tracking-wider">
                          {docItem.category || "General"}
                        </span>
                        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-black text-muted-foreground">
                          {badge}
                        </span>
                        {docItem.file_size && (
                          <span className="text-[11px] font-semibold text-muted-foreground">
                            · {docItem.file_size}
                          </span>
                        )}
                      </div>

                      <h3 className="mt-1 text-sm font-black text-[#12131A] truncate tracking-tight">
                        {docItem.name}
                      </h3>
                    </div>
                  </div>

                  {/* Actions Strip */}
                  <div className="flex items-center gap-1 shrink-0">
                    {docItem.file_url && (
                      <button
                        onClick={() => {
                          sounds.playClick();
                          setPreviewDoc(docItem);
                        }}
                        title="Preview Document"
                        className="tap flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 hover:bg-slate-100 hover:text-[#12131A] transition-colors"
                      >
                        <Eye className="size-4" />
                      </button>
                    )}
                    <button
                      onClick={() => openEditModal(docItem)}
                      title="Edit Document Info"
                      className="tap flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 hover:bg-slate-100 transition-colors"
                    >
                      <Edit2 className="size-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(docItem.id, docItem.name)}
                      title="Delete"
                      className="tap flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 hover:bg-rose-50 transition-colors"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════
          UPLOAD / EDIT DOCUMENT MODAL
          ══════════════════════════════════════════════════════════════ */}
      <Modal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        className="bg-white max-w-lg"
      >
        <div className="flex items-center justify-between border-b border-black/5 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-xl bg-[#12131A] text-white">
              <Upload className="size-4" />
            </div>
            <div>
              <h3 className="text-base font-black text-[#12131A]">
                {editingDoc ? "Edit Document Info" : "Upload to Vault"}
              </h3>
              <p className="text-[11px] font-semibold text-muted-foreground">
                Securely store prescriptions, tests & certificates
              </p>
            </div>
          </div>
          <button
            onClick={() => setUploadModalOpen(false)}
            className="tap flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-black/5 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleUploadSubmit} className="mt-4 space-y-3.5">
          <div>
            <label className="text-xs font-bold text-[#12131A]">Document Title</label>
            <input
              type="text"
              required
              placeholder="e.g. Annual Blood Panel / Passport Scan / Prescription"
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-black/10 bg-[#F9F9FD] p-2.5 text-xs font-bold outline-none focus:border-[#7C5CFC] focus:bg-white transition-colors"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-[#12131A]">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full rounded-xl border border-black/10 bg-[#F9F9FD] p-2.5 text-xs font-bold outline-none focus:border-[#7C5CFC] focus:bg-white transition-colors"
            >
              {DOCUMENT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {!editingDoc && (
            <div>
              <label className="text-xs font-bold text-[#12131A] block mb-1">
                Select File (PDF or Image)
              </label>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files?.[0]) {
                    handleFileSelect(e.dataTransfer.files[0]);
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "cursor-pointer rounded-2xl border-2 border-dashed p-5 text-center transition-all",
                  isDragging
                    ? "border-[#7C5CFC] bg-[#7C5CFC]/5"
                    : selectedFile
                      ? "border-emerald-500/40 bg-emerald-50/30"
                      : "border-black/10 bg-[#F9F9FD] hover:border-black/20 hover:bg-slate-50",
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf,text/*"
                  onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
                  className="hidden"
                />

                {selectedFile ? (
                  <div className="flex items-center justify-center gap-3">
                    {filePreviewUrl ? (
                      <img
                        src={filePreviewUrl}
                        alt="Preview"
                        className="size-12 rounded-xl object-cover border shadow-2xs"
                      />
                    ) : (
                      <div className="flex size-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
                        <FileCheck className="size-6" />
                      </div>
                    )}
                    <div className="text-left">
                      <p className="text-xs font-black text-[#12131A] truncate max-w-[200px]">
                        {selectedFile.name}
                      </p>
                      <p className="text-[11px] font-bold text-muted-foreground">
                        {formatFileSize(selectedFile.size)} · Click to change file
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Upload className="mx-auto size-7 text-muted-foreground/60" />
                    <p className="text-xs font-black text-[#12131A]">
                      Drop file here or click to browse
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Supports PDF, PNG, JPG, WEBP up to 10MB
                    </p>
                  </div>
                )}
              </div>

              {submitting && uploadProgress > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs font-black text-muted-foreground mb-1">
                    <span>Uploading file securely...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#7C5CFC] transition-all duration-300 rounded-full"
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
              className="w-1/2 rounded-xl border border-black/10 py-2.5 text-xs font-black text-muted-foreground hover:bg-black/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="tap w-1/2 flex items-center justify-center gap-1.5 rounded-xl bg-[#12131A] py-2.5 text-xs font-black text-white shadow-md hover:bg-slate-800 disabled:opacity-50 transition-transform active:scale-95"
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              {submitting ? "Uploading..." : "Save Document"}
            </button>
          </div>
        </form>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════
          PREVIEW MODAL
          ══════════════════════════════════════════════════════════════ */}
      {previewDoc && (
        <Modal open onClose={() => setPreviewDoc(null)} className="bg-white max-w-xl">
          <div className="flex items-center justify-between border-b border-black/5 pb-3">
            <div className="min-w-0 pr-2">
              <h2 className="text-base font-black text-[#12131A] truncate">{previewDoc.name}</h2>
              <span className="text-[11px] font-bold text-muted-foreground">
                Category: {previewDoc.category} · {previewDoc.file_size || "Standard"}
              </span>
            </div>
            <button
              onClick={() => setPreviewDoc(null)}
              className="tap flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-black/5 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 hover:text-foreground shrink-0"
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
                  className="max-h-80 w-full rounded-2xl object-contain border shadow-sm bg-slate-50"
                />
              ) : previewDoc.file_url.match(/\.pdf(\?.*)?$/i) ? (
                <iframe
                  src={previewDoc.file_url}
                  title="PDF Preview"
                  className="w-full h-80 rounded-2xl border border-slate-200"
                />
              ) : (
                <div className="p-8 text-center rounded-2xl bg-slate-50 border w-full">
                  <FileText className="mx-auto size-16 text-slate-400" />
                  <p className="text-xs font-bold text-muted-foreground mt-2">
                    Direct viewer preview not available for this file type.
                  </p>
                </div>
              )
            ) : (
              <div className="p-8 text-center rounded-2xl bg-slate-50 border w-full">
                <FileText className="mx-auto size-16 text-slate-400" />
                <p className="text-xs font-bold text-muted-foreground mt-2">No file attached</p>
              </div>
            )}

            {previewDoc.file_url && (
              <a
                href={previewDoc.file_url}
                target="_blank"
                rel="noreferrer"
                className="tap mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#12131A] px-5 py-2.5 text-xs font-black text-white shadow-md hover:bg-slate-800 transition-colors"
              >
                <ExternalLink className="size-3.5" /> Open / Download File
              </a>
            )}
          </div>
        </Modal>
      )}
    </Screen>
  );
}
