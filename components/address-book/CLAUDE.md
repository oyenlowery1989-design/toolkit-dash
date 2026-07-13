## Address Book Conflict Warning
- `AddressBookPanel.tsx` imports `useKnownIntermediaries`, `useKnownCreators`, `useAssetGroups`
- `EntryForm` computes `conflict` inline (not a hook) — checks the typed address against all three sources live
- Warning shown only on Add form (not edit). Shows entity name, type, and "View group →" link for group conflicts
- Do NOT auto-add group members to address book — group membership already provides label + badge everywhere via ShortAddress
