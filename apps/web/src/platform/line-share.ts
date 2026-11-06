import type { Invite } from "@split/shared";
import { ensureInvite } from "../groups/api.js";
import { groupKeys, useGroupData } from "../groups/data.js";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useDeps } from "../app/AppProviders.js";
import type { ApiClient } from "../api/client.js";
import { LineShareUnavailableError, type LineMessage, type LineSignIn } from "./line.js";

export interface LineShareContent {
  text: string;
  lineMessages?: LineMessage[];
}

export function lineShareLink(text: string): string {
  return `https://line.me/R/share?text=${encodeURIComponent(text)}`;
}

/** Owns the picker protocol; an unavailable picker can still send the text through LINE. */
export function createLineShare({
  line,
  api,
  client,
  location = window.location,
}: {
  line: LineSignIn;
  api: ApiClient;
  client: QueryClient;
  location?: Pick<Location, "assign">;
}) {
  return {
    post: (messages: LineMessage[]) => line.sendToChat(messages),
    canPost: () => line.canSendToChat(),
    async inviteToken(groupId: string, options: { cached?: boolean } = {}): Promise<string | null> {
      const cached =
        options.cached === true
          ? client.getQueryData<Invite>(groupKeys.invite(groupId))
          : undefined;
      try {
        const invite = cached ?? (await ensureInvite(api, client, groupId));
        return invite.token;
      } catch {
        return null;
      }
    },
    async share(content: LineShareContent, purpose: "invite" | "settlement" | "expense") {
      try {
        const options = { stayOpen: purpose !== "expense" };
        return content.lineMessages === undefined
          ? await line.share(content.text, options)
          : await line.shareMessages(content.lineMessages, options);
      } catch (error) {
        if (!(error instanceof LineShareUnavailableError)) throw error;
        location.assign(lineShareLink(content.text));
        return false;
      }
    },
  };
}

/** Only screens with a chat checkbox ask for its capability; edits never ask. */
export function useLineShare(checkChat = false) {
  const { line } = useDeps();
  const { api } = useGroupData();
  const client = useQueryClient();
  const sharing = useMemo(() => createLineShare({ line, api, client }), [line, api, client]);
  const [chatAvailable, setChatAvailable] = useState(false);
  useEffect(() => {
    if (!checkChat) return;
    let current = true;
    void sharing.canPost().then((available) => {
      if (current) setChatAvailable(available);
    });
    return () => {
      current = false;
    };
  }, [checkChat, sharing]);
  return { ...sharing, chatAvailable: checkChat && chatAvailable };
}
