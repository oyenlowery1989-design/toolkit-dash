export interface PersonAddress {
  id: string;
  personId: string;
  address: string;
  label?: string;
  addedAt: number;
}

export interface Person {
  id: string;
  name: string;
  role?: string;
  notes?: string;
  addresses: PersonAddress[];
  createdAt: number;
  updatedAt: number;
}
