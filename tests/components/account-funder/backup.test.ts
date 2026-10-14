import { expect, it } from "vitest";
import { matchesChildrenBackup } from "@/components/account-funder/AccountFunderPanel";

it("requires every current child key in the downloaded backup", () => {
  const accounts = [{ publicKey: "GONE", secretKey: "SONE" }, { publicKey: "GTWO", secretKey: "STWO" }];
  expect(matchesChildrenBackup("public_key,secret_key,status\nGONE,SONE,pending\nGTWO,STWO,pending", accounts)).toBe(true);
  expect(matchesChildrenBackup("public_key,secret_key,status\nGONE,SONE,pending", accounts)).toBe(false);
  expect(matchesChildrenBackup("public_key,secret_key,status\nGONE,SONE,pending\nGTWO,WRONG,pending", accounts)).toBe(false);
});
