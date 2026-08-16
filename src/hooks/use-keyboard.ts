import { useState, useEffect, useRef } from "react";

interface KeyboardState {
  isKeyboardOpen: boolean;
  keyboardHeight: number;
  isInputFocused: boolean;
}

/**
 * Universal Mobile Virtual Keyboard Detection Hook
 *
 * Reliably detects keyboard open/close states across:
 * - Android WebView / Capacitor (where window.innerHeight shrinks with visualViewport)
 * - iOS Safari / WebKit (where visualViewport shrinks but window.innerHeight stays constant)
 * - Mobile Chrome / Firefox
 */
export function useKeyboard(): KeyboardState {
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const initialHeightRef = useRef<number>(typeof window !== "undefined" ? window.innerHeight : 0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Record initial baseline height when no element is focused
    if (!document.activeElement || document.activeElement === document.body) {
      initialHeightRef.current = window.innerHeight;
    }

    const isEditableElement = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === "textarea") return true;
      if (tag === "input") {
        const type = (el as HTMLInputElement).type?.toLowerCase();
        const nonTextTypes = ["checkbox", "radio", "button", "submit", "file", "range", "color", "image", "reset"];
        return !nonTextTypes.includes(type);
      }
      return el.getAttribute("contenteditable") === "true";
    };

    const evaluateKeyboard = () => {
      const vv = window.visualViewport;
      const focused = isEditableElement(document.activeElement);
      setIsInputFocused(focused);

      const baseline = initialHeightRef.current || window.innerHeight;
      const currentHeight = vv ? vv.height : window.innerHeight;
      const heightDiff = baseline - currentHeight;

      // Detect keyboard:
      // 1. If visualViewport shrank by > 120px from baseline
      // 2. Or if an editable element is focused and height is significantly less than screen height
      const keyboardDetected =
        heightDiff > 120 ||
        (focused && typeof window.screen !== "undefined" && currentHeight < window.screen.availHeight * 0.78);

      setIsKeyboardOpen(keyboardDetected || focused);
      setKeyboardHeight(keyboardDetected ? Math.max(0, heightDiff) : 0);
    };

    const handleFocusIn = (e: FocusEvent) => {
      if (isEditableElement(e.target as Element)) {
        setIsInputFocused(true);
        // Small timeout allows visualViewport to begin resizing on Android/iOS
        setTimeout(evaluateKeyboard, 50);
        setTimeout(evaluateKeyboard, 250);
      }
    };

    const handleFocusOut = () => {
      setTimeout(() => {
        const focused = isEditableElement(document.activeElement);
        setIsInputFocused(focused);
        if (!focused) {
          setIsKeyboardOpen(false);
          setKeyboardHeight(0);
          initialHeightRef.current = window.innerHeight;
        }
      }, 100);
    };

    const handleResize = () => {
      evaluateKeyboard();
    };

    window.addEventListener("focusin", handleFocusIn);
    window.addEventListener("focusout", handleFocusOut);
    window.addEventListener("resize", handleResize);

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", handleResize);
      window.visualViewport.addEventListener("scroll", handleResize);
    }

    return () => {
      window.removeEventListener("focusin", handleFocusIn);
      window.removeEventListener("focusout", handleFocusOut);
      window.removeEventListener("resize", handleResize);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", handleResize);
        window.visualViewport.removeEventListener("scroll", handleResize);
      }
    };
  }, []);

  return { isKeyboardOpen, keyboardHeight, isInputFocused };
}
