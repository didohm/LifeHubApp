/**
 * Save a generated activity-card PNG to the Android device Gallery.
 *
 * Android: the native GallerySaverPlugin writes the image through
 * MediaStore (API 29+) or to the public Pictures/LifeHub folder (API ≤ 28,
 * with the legacy WRITE_EXTERNAL_STORAGE runtime permission requested only
 * on those versions). No @capacitor/share, no share sheet.
 *
 * Web fallback: plain file download (used for development/testing only).
 */

import { Capacitor, registerPlugin } from "@capacitor/core";

interface GallerySaverPlugin {
  saveImageToGallery(options: {
    base64: string;
    fileName: string;
  }): Promise<{ saved: boolean; path?: string }>;
}

let gallerySaverPlugin: GallerySaverPlugin | null = null;
if (Capacitor.isNativePlatform()) {
  gallerySaverPlugin = registerPlugin<GallerySaverPlugin>("GallerySaver");
}

/**
 * Save a PNG blob to the device Gallery. Returns the location the image was
 * saved to ("Gallery" on native, "Downloads" for the web fallback).
 */
export async function savePngToGallery(blob: Blob, fileName: string): Promise<string> {
  if (gallerySaverPlugin) {
    const base64 = await blobToBase64(blob);
    const result = await gallerySaverPlugin.saveImageToGallery({ base64, fileName });
    if (!result || !result.saved) {
      throw new Error("Native Gallery save failed");
    }
    return "Gallery";
  }

  // Web fallback — direct download, never a share sheet.
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "Downloads";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read PNG blob"));
    reader.readAsDataURL(blob);
  });
}
