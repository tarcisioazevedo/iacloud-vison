import { FrigateConfig } from "@/types/frigateConfig";
import { NavData } from "@/types/navigation";
import { useMemo } from "react";
import { isDesktop } from "react-device-detect";
import { FaCompactDisc, FaVideo } from "react-icons/fa";
import { IoSearch } from "react-icons/io5";
import { LuConstruction, LuBrainCircuit } from "react-icons/lu";
import { MdCategory, MdChat, MdVideoLibrary, MdDashboard } from "react-icons/md";
import { TbFaceId } from "react-icons/tb";
import useSWR from "swr";
import { useIsAdmin } from "./use-is-admin";
import { hasGenAIRole } from "@/utils/genai";

export const ID_LIVE = 1;
export const ID_REVIEW = 2;
export const ID_EXPLORE = 3;
export const ID_EXPORT = 4;
export const ID_PLAYGROUND = 5;
export const ID_FACE_LIBRARY = 6;
export const ID_CLASSIFICATION = 7;
export const ID_CHAT = 8;
export const ID_COCKPIT = 9;
export const ID_TRAINING = 10;

export default function useNavigation(
  variant: "primary" | "secondary" = "primary",
) {
  const { data: config } = useSWR<FrigateConfig>("config", {
    revalidateOnFocus: false,
  });
  const isAdmin = useIsAdmin();
  const hasChatRole = hasGenAIRole(config, "chat");

  return useMemo(
    () =>
      [
        {
          id: ID_LIVE,
          variant,
          icon: FaVideo,
          title: "menu.live.title",
          url: "/",
        },
        {
          id: ID_COCKPIT,
          variant,
          icon: MdDashboard,
          title: "menu.cockpit",
          url: "/cockpit",
          enabled: isDesktop && isAdmin,
        },
        {
          id: ID_REVIEW,
          variant,
          icon: MdVideoLibrary,
          title: "menu.review",
          url: "/review",
        },
        {
          id: ID_EXPLORE,
          variant,
          icon: IoSearch,
          title: "menu.explore",
          url: "/explore",
        },
        {
          id: ID_CHAT,
          variant,
          icon: MdChat,
          title: "menu.chat",
          url: "/chat",
          enabled: isDesktop && isAdmin && hasChatRole,
        },
        {
          id: ID_EXPORT,
          variant,
          icon: FaCompactDisc,
          title: "menu.export",
          url: "/export",
        },
        {
          id: ID_FACE_LIBRARY,
          variant,
          icon: TbFaceId,
          title: "menu.faceLibrary",
          url: "/faces",
          enabled: isDesktop && config?.face_recognition.enabled && isAdmin,
        },
        {
          id: ID_TRAINING,
          variant,
          icon: LuBrainCircuit,
          title: "menu.trainingCenter",
          url: "/training-center",
          enabled: isDesktop && isAdmin,
        },
        {
          id: ID_CLASSIFICATION,
          variant,
          icon: MdCategory,
          title: "menu.classification",
          url: "/classification",
          enabled: isDesktop && isAdmin,
        },
        {
          id: ID_PLAYGROUND,
          variant,
          icon: LuConstruction,
          title: "menu.uiPlayground",
          url: "/playground",
          enabled: isDesktop && isAdmin,
        },
      ] as NavData[],
    [config?.face_recognition?.enabled, hasChatRole, variant, isAdmin],
  );
}
