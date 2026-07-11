export interface PersonAddress {
  id: string;
  personId: string;
  address: string;
  label?: string;
  addedAt: number;
}

export type PersonRelationshipType = "friend" | "colleague" | "invited_by";

/** One relationship edge, from the perspective of the person it's attached
 *  to. `personId` is the OTHER person in the relationship. `direction` is
 *  only meaningful for "invited_by": "inviter" means this person invited
 *  the other; "invitee" means this person was invited by the other. */
export interface PersonRelationshipRef {
  id: string;
  personId: string;
  type: PersonRelationshipType;
  direction?: "inviter" | "invitee";
}

export interface Person {
  id: string;
  name: string;
  role?: string;
  notes?: string;
  telegramUsername?: string;
  addresses: PersonAddress[];
  relationships: PersonRelationshipRef[];
  createdAt: number;
  updatedAt: number;
}
