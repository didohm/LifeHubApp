/**
 * Cloudinary Upload Service
 *
 * Handles file uploads to Cloudinary using unsigned upload presets.
 * Two presets configured:
 * - 'documents': For document uploads (PDFs, images, text files)
 * - 'avatars': For user profile avatars
 */

// Cloudinary configuration
const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/upload`;

// Upload presets (unsigned)
const PRESETS = {
  documents: "documents",
  avatars: "avatars",
} as const;

export type UploadPreset = keyof typeof PRESETS;

export interface CloudinaryUploadResult {
  public_id: string;
  secure_url: string;
  url: string;
  format: string;
  resource_type: string;
  bytes: number;
  width?: number;
  height?: number;
  created_at: string;
}

export interface UploadOptions {
  preset: UploadPreset;
  file: File;
  onProgress?: (progress: number) => void;
}

/**
 * Validates that Cloudinary is properly configured
 */
function validateConfig(): void {
  if (!CLOUDINARY_CLOUD_NAME) {
    throw new Error(
      "Cloudinary cloud name is not configured. Please set VITE_CLOUDINARY_CLOUD_NAME in your .env file.",
    );
  }
}

/**
 * Uploads a file to Cloudinary using unsigned upload
 *
 * @param options Upload configuration
 * @returns Cloudinary upload result with secure URL and metadata
 */
export async function uploadToCloudinary(options: UploadOptions): Promise<CloudinaryUploadResult> {
  validateConfig();

  const { preset, file, onProgress } = options;
  const uploadPreset = PRESETS[preset];

  // Create FormData for upload
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // Track upload progress
    if (onProgress) {
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          onProgress(progress);
        }
      });
    }

    // Handle completion
    xhr.addEventListener("load", () => {
      if (xhr.status === 200) {
        try {
          const result = JSON.parse(xhr.responseText) as CloudinaryUploadResult;
          resolve(result);
        } catch (error) {
          reject(new Error("Failed to parse Cloudinary response"));
        }
      } else {
        let errorMessage = "Upload failed";
        try {
          const errorData = JSON.parse(xhr.responseText);
          errorMessage = errorData.error?.message || errorMessage;
        } catch {
          // Use default error message
        }
        reject(new Error(errorMessage));
      }
    });

    // Handle errors
    xhr.addEventListener("error", () => {
      reject(new Error("Network error during upload"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload cancelled"));
    });

    // Send request
    xhr.open("POST", CLOUDINARY_UPLOAD_URL);
    xhr.send(formData);
  });
}

/**
 * Uploads a document file to Cloudinary
 * Uses the 'documents' preset with folder: documents
 *
 * @param file File to upload
 * @param onProgress Optional progress callback
 * @returns Upload result with secure URL
 */
export async function uploadDocument(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<CloudinaryUploadResult> {
  return uploadToCloudinary({
    preset: "documents",
    file,
    onProgress,
  });
}

/**
 * Uploads an avatar image to Cloudinary
 * Uses the 'avatars' preset with folder: avatars
 *
 * @param file Image file to upload
 * @param onProgress Optional progress callback
 * @returns Upload result with secure URL
 */
export async function uploadAvatar(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<CloudinaryUploadResult> {
  return uploadToCloudinary({
    preset: "avatars",
    file,
    onProgress,
  });
}

/**
 * Validates file size against a maximum limit
 *
 * @param file File to validate
 * @param maxSizeBytes Maximum allowed size in bytes
 * @returns true if file is within limit
 */
export function validateFileSize(file: File, maxSizeBytes: number): boolean {
  return file.size <= maxSizeBytes;
}

/**
 * Validates file type against allowed MIME types
 *
 * @param file File to validate
 * @param allowedTypes Array of allowed MIME type prefixes (e.g., ['image/', 'application/pdf'])
 * @returns true if file type is allowed
 */
export function validateFileType(file: File, allowedTypes: string[]): boolean {
  return allowedTypes.some((type) => file.type.startsWith(type));
}

/**
 * Formats file size in human-readable format
 *
 * @param bytes File size in bytes
 * @returns Formatted string (e.g., "1.5 MB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Extracts public_id from a Cloudinary URL
 * Useful for deletion or transformation operations
 *
 * @param url Cloudinary secure URL
 * @returns Public ID or null if not found
 */
export function extractPublicId(url: string): string | null {
  try {
    const urlParts = url.split("/");
    const uploadIndex = urlParts.indexOf("upload");
    if (uploadIndex === -1) return null;

    // Get everything after 'upload' and version (if present)
    const pathAfterUpload = urlParts.slice(uploadIndex + 1);
    // Skip version if present (starts with 'v')
    const startIndex = pathAfterUpload[0]?.startsWith("v") ? 1 : 0;

    // Join remaining parts and remove file extension
    const publicIdWithExt = pathAfterUpload.slice(startIndex).join("/");
    const lastDotIndex = publicIdWithExt.lastIndexOf(".");
    return lastDotIndex > 0 ? publicIdWithExt.substring(0, lastDotIndex) : publicIdWithExt;
  } catch {
    return null;
  }
}

/**
 * Generates a Cloudinary transformation URL
 *
 * @param publicId Public ID of the asset
 * @param transformations Transformation parameters (e.g., 'w_200,h_200,c_fill')
 * @returns Transformed URL
 */
export function getTransformedUrl(publicId: string, transformations: string): string {
  validateConfig();
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/${transformations}/${publicId}`;
}
