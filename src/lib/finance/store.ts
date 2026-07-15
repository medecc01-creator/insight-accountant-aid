import { get, set } from "idb-keyval";
import type { DBShape, Transaction, Template } from "./types";

const KEY = "compta-db-v1";

export const DEFAULT_CATEGORIES = [
  "Maison", "Voiture", "Courses", "Carburant", "École",
  "Divers", "Santé", "Cadeaux", "Vacances/Loisirs", "Frais Travail",
];

export const emptyDB = (): DBShape => ({
  transactions: [],
  templates: [],
  categories: [...DEFAULT_CATEGORIES],
  version: 1,
});

export async function loadDB(): Promise<DBShape> {
  try {
    const data = (await get<DBShape>(KEY)) ?? emptyDB();
    if (!data.transactions) data.transactions = [];
    if (!data.templates) data.templates = [];
    if (!data.categories || data.categories.length === 0) data.categories = [...DEFAULT_CATEGORIES];
    return data;
  } catch {
    return emptyDB();
  }
}

export async function saveDB(db: DBShape) {
  await set(KEY, db);
}

export function upsertTemplate(db: DBShape, t: Template) {
  const libelleTemplate = t.libelle || "";
  const key = libelleTemplate.trim().toLowerCase();

  if (!key) return; // Si le libellé est vide, on ne l'enregistre pas comme modèle

  const idx = db.templates.findIndex((x) =>
    (x.libelle || "").trim().toLowerCase() === key
  );

  if (idx >= 0) {
    db.templates[idx] = { ...db.templates[idx], ...t };
  } else {
    db.templates.push(t);
  }
}

export function learnFromTransaction(db: DBShape, tx: Transaction) {
  upsertTemplate(db, {
    libelle: tx.libelle,
    categorie: tx.categorie || undefined,
    moyenPaiement: tx.moyenPaiement || undefined,
  });
}

export function suggestFromLibelle(db: DBShape, libelle: string): Template | null {
  const safeLibelle = libelle || "";
  const key = safeLibelle.trim().toLowerCase();
  if (!key) return null;
  
  // Prefer last transaction match (sécurisé)
  const lastTx = [...db.transactions].reverse().find(
    (t) => (t.libelle || "").trim().toLowerCase() === key,
  );
  );
  if (lastTx) {
    return {
      libelle: lastTx.libelle,
      categorie: lastTx.categorie,
      moyenPaiement: lastTx.moyenPaiement,
    };
  }
return db.templates.find((t) => (t.libelle || "").trim().toLowerCase() === key) ?? null;
}

eexport function autocomplete(db: DBShape, query: string, limit = 8): Template[] {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  const seen = new Set<string>();
  const out: Template[] = [];
  
  // From transactions (most recent first)
  for (let i = db.transactions.length - 1; i >= 0; i--) {
    const t = db.transactions[i];
    if (!t) continue; // Sécurité si la transaction elle-même est nulle
    
    const libelle = t.libelle || "";
    const k = libelle.trim().toLowerCase();
    
    if (k && !seen.has(k) && k.includes(q)) {
      seen.add(k);
      out.push({ libelle: t.libelle, categorie: t.categorie, moyenPaiement: t.moyenPaiement });
      if (out.length >= limit) return out;
    }
  }
  for (const t of db.templates) {
    if (!t) continue; // Sécurité si le template lui-même est nul
    
    const libelle = t.libelle || "";
    const k = libelle.trim().toLowerCase();
    
    if (k && !seen.has(k) && k.includes(q)) {
      seen.add(k);
      out.push(t);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
