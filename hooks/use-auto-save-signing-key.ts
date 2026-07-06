// hooks/use-auto-save-signing-key.ts
// After a manual secret key is used to sign, call `autoSave(publicKey)` to
// automatically save the address into the "My Keys" group with role "other"
// if it isn't already in any asset group.

import { useCallback } from "react";
import { toast } from "sonner";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { useSettings } from "@/lib/settings";
import { shortAddr } from "@/lib/format";

const MY_KEYS_GROUP_NAME = "My Keys";

export function useAutoSaveSigningKey() {
  const { groups, createGroup, upsertMember } = useAssetGroups();
  const { settings } = useSettings();

  const autoSave = useCallback(
    (publicKey: string) => {
      if (!publicKey) return;

      // Check if already in any group
      const alreadyInGroup = groups.some((g) =>
        g.members.some((m) => m.address === publicKey),
      );
      if (alreadyInGroup) return;

      // Find or create "My Keys" group
      let groupId = groups.find((g) => g.name === MY_KEYS_GROUP_NAME)?.id;
      if (!groupId) {
        groupId = createGroup({
          name: MY_KEYS_GROUP_NAME,
          network: settings.network,
        });
      }

      // Add with role "other"
      upsertMember(groupId, {
        address: publicKey,
        role: "other",
        label: "",
        notes: `Auto-saved signing key — ${new Date().toLocaleDateString()}`,
      });

      toast.success(`Signing key ${shortAddr(publicKey)} saved to "${MY_KEYS_GROUP_NAME}" → reassign when ready.`);
    },
    [groups, createGroup, upsertMember, settings.network],
  );

  return { autoSave };
}
