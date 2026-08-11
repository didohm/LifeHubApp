import { useRef, useCallback } from "react";

/**
 * Custom hook to prevent rapid-fire deletes
 * Tracks which IDs are currently being deleted to prevent duplicate delete operations
 *
 * @returns Object with deleteWithGuard function and isDeletingId checker
 *
 * @example
 * const { deleteWithGuard, isDeletingId } = useDeleteWithGuard();
 *
 * const handleDelete = deleteWithGuard(itemId, async () => {
 *   await deleteItem(itemId);
 * });
 */
export function useDeleteWithGuard() {
  const deletingIds = useRef<Set<string>>(new Set());

  const deleteWithGuard = useCallback((id: string, deleteFn: () => Promise<void>) => {
    return async () => {
      if (deletingIds.current.has(id)) return;
      deletingIds.current.add(id);
      try {
        await deleteFn();
      } finally {
        deletingIds.current.delete(id);
      }
    };
  }, []);

  const isDeletingId = useCallback((id: string) => {
    return deletingIds.current.has(id);
  }, []);

  return { deleteWithGuard, isDeletingId };
}
