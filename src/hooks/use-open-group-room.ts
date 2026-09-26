"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { enterGroupAssignmentRoom } from "@/lib/sync/assignment-rooms";
import { ledgerErrorMessage } from "@/lib/sync/errors";

export interface OpenableGroupRoom {
  id: string;
  host: { id: string };
}

export interface OpenGroupRoom {
  pendingRoomId: string | null;
  openRoom: (room: OpenableGroupRoom) => Promise<void>;
}

export function useOpenGroupRoom(groupId: string, viewerId: string | null): OpenGroupRoom {
  const router = useRouter();
  const [pendingRoomId, setPendingRoomId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const openRoom = useCallback(
    async (room: OpenableGroupRoom) => {
      if (pendingRoomId !== null) return;
      if (room.host.id === viewerId) {
        router.push(`/room/${room.id}`);
        return;
      }
      setPendingRoomId(room.id);
      try {
        await enterGroupAssignmentRoom({ groupId, roomId: room.id });
        if (!mountedRef.current) return;
        router.push(`/room/${room.id}`);
      } catch (error) {
        toast.error(ledgerErrorMessage(error));
        setPendingRoomId(null);
      }
    },
    [groupId, viewerId, pendingRoomId, router],
  );

  return { pendingRoomId, openRoom };
}
