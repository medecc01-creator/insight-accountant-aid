export type Categorie =
  | "Maison"
  | "Voiture"
  | "Courses"
  | "Carburant"
  | "École"
  | "Ecole"
  | "Divers"
  | "Santé"
  | "Cadeaux"
  | "Vacances/Loisirs"
  | "Frais Travail"
  | string;

export type MoyenPaiement = "CB" | "Virement" | "Paypal" | "Chèque" | "Espèces" | string;

export interface Transaction {
  id: string;
  year: number;
  month: number; // 1-12
  date: string | null; // ISO yyyy-mm-dd or null (recurring not yet dated)
  libelle: string;
  categorie: string;
  recettes: number; // positive
  depenses: number; // positive number stored as absolute value
  moyenPaiement: string;
  pointe: boolean;
}

export interface Template {
  libelle: string;
  categorie?: string;
  moyenPaiement?: string;
}

export interface DBShape {
  transactions: Transaction[];
  templates: Template[];
  version: 1;
}
