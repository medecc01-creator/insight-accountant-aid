import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LabelList,
} from "recharts";
import {
  Upload, Download, Plus, Search, Wallet, TrendingUp, TrendingDown,
  CheckCircle2, Clock, X, FileUp, Database, Landmark, Circle,
} from "lucide-react";
import { toast, Toaster } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import type { DBShape, Transaction } from "@/lib/finance/types";
import { loadDB, saveDB, autocomplete, suggestFromLibelle, learnFromTransaction, upsertTemplate, emptyDB } from "@/lib/finance/store";
import { parseComptaCSV, parseBankCSV, parseAmount, cleanBankLibelle, MONTH_LABELS, type BankLine } from "@/lib/finance/parser";

export const Route = createFileRoute("/")({
  component: App,
});

const CATEGORY_COLORS: Record<string, string> = {
  Maison: "#6366f1",
  Voiture: "#22d3ee",
  Courses: "#f59e0b",
  Carburant: "#f43f5e",
  École: "#a78bfa",
  Ecole: "#a78bfa",
  Divers: "#94a3b8",
  Santé: "#10b981",
  Cadeaux: "#ec4899",
  "Vacances/Loisirs": "#eab308",
  "Frais Travail": "#0ea5e9",
};
const colorFor = (c: string) => CATEGORY_COLORS[c] ?? "#64748b";

const fmt = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n);

async function readFileAsText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  // Try strict UTF-8 first
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    // Fallback to windows-1252 (typical for French exports from Excel)
    return new TextDecoder("windows-1252").decode(buf);
  }
}

function App() {
  const [db, setDb] = useState<DBShape>(emptyDB());
  const [ready, setReady] = useState(false);
  const [currentMonth, setCurrentMonth] = useState<number>(new Date().getMonth() + 1);
  const [currentYear, setCurrentYear] = useState<number>(new Date().getFullYear());

  useEffect(() => {
    loadDB().then((d) => {
      setDb(d);
      setReady(true);
      // Focus on most recent month with data
      if (d.transactions.length) {
        const last = d.transactions[d.transactions.length - 1];
        setCurrentMonth(last.month);
        setCurrentYear(last.year);
      }
    });
  }, []);

  useEffect(() => {
    if (ready) saveDB(db);
  }, [db, ready]);

  const persist = (updater: (d: DBShape) => DBShape) => setDb((d) => updater({ ...d, transactions: [...d.transactions], templates: [...d.templates] }));

  // ------- Import compta CSV -------
  const handleComptaImport = async (file: File) => {
    try {
      const text = await readFileAsText(file);
      const { transactions, templates, year, month } = parseComptaCSV(text, file.name);
      persist((d) => {
        // Remove existing tx for that year/month (replace import)
        d.transactions = d.transactions.filter((t) => !(t.year === year && t.month === month));
        d.transactions.push(...transactions);
        for (const t of templates) upsertTemplate(d, { libelle: t.libelle });
        for (const tx of transactions) learnFromTransaction(d, tx);
        return d;
      });
      setCurrentMonth(month);
      setCurrentYear(year);
      toast.success(`Importé : ${transactions.length} transactions (${MONTH_LABELS[month - 1]} ${year})`);
    } catch (e) {
      toast.error("Erreur d'import : " + (e as Error).message);
    }
  };

  // ------- Years available -------
  const years = useMemo(() => {
    const s = new Set<number>();
    db.transactions.forEach((t) => s.add(t.year));
    s.add(currentYear);
    return Array.from(s).sort();
  }, [db.transactions, currentYear]);

  const monthTx = useMemo(
    () => db.transactions.filter((t) => t.year === currentYear && t.month === currentMonth),
    [db.transactions, currentYear, currentMonth],
  );

  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-right" richColors theme="dark" />
      <Header
        db={db}
        onImportCompta={handleComptaImport}
        onRestore={(newDb) => setDb(newDb)}
      />

      <main className="mx-auto max-w-[1400px] px-6 pb-16 pt-6">
        {db.transactions.length === 0 && db.templates.length === 0 ? (
          <EmptyState onImport={handleComptaImport} />
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <Select value={String(currentYear)} onValueChange={(v) => setCurrentYear(+v)}>
                <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
              <ImportComptaButton onFile={handleComptaImport} />
            </div>

            <Tabs value={String(currentMonth)} onValueChange={(v) => setCurrentMonth(+v)}>
              <TabsList className="mb-6 h-auto flex-wrap bg-card p-1">
                {MONTH_LABELS.map((label, i) => {
                  const hasData = db.transactions.some(
                    (t) => t.year === currentYear && t.month === i + 1,
                  );
                  return (
                    <TabsTrigger
                      key={i}
                      value={String(i + 1)}
                      className={cn("relative", hasData && "font-semibold")}
                    >
                      {label}
                      {hasData && (
                        <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              <TabsContent value={String(currentMonth)} className="space-y-6">
                <MonthDashboard tx={monthTx} />
                <MonthWorkspace
                  db={db}
                  setDb={setDb}
                  persist={persist}
                  currentMonth={currentMonth}
                  currentYear={currentYear}
                />
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
    </div>
  );
}

// ---------------- Header ----------------

function Header({
  db, onImportCompta, onRestore,
}: {
  db: DBShape;
  onImportCompta: (f: File) => void;
  onRestore: (db: DBShape) => void;
}) {
  const restoreRef = useRef<HTMLInputElement>(null);

  const doExport = () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `comptes-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Sauvegarde téléchargée");
  };

  const doRestore = async (f: File) => {
    try {
      const text = await f.text();
      const parsed = JSON.parse(text) as DBShape;
      if (!Array.isArray(parsed.transactions)) throw new Error("Fichier invalide");
      onRestore(parsed);
      toast.success("Données restaurées");
    } catch (e) {
      toast.error("Restauration impossible : " + (e as Error).message);
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight">Comptes</h1>
            <p className="text-xs text-muted-foreground">Comptabilité personnelle · 100% local</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={doExport}>
            <Download className="mr-2 h-4 w-4" /> Export JSON
          </Button>
          <Button variant="ghost" size="sm" onClick={() => restoreRef.current?.click()}>
            <Database className="mr-2 h-4 w-4" /> Restaurer
          </Button>
          <input
            ref={restoreRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) doRestore(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>
    </header>
  );
}

// ---------------- Empty state / drag-drop ----------------

function EmptyState({ onImport }: { onImport: (f: File) => void }) {
  return (
    <div className="mt-10">
      <DropZone onFile={onImport} label="Glissez votre fichier CSV de comptes ici" hint="Ou cliquez pour parcourir. Format : point-virgule (;)" large />
    </div>
  );
}

function DropZone({
  onFile, label, hint, large,
}: {
  onFile: (f: File) => void;
  label: string;
  hint?: string;
  large?: boolean;
}) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-card/50 text-center transition-colors hover:border-primary/50 hover:bg-card",
        drag && "border-primary bg-primary/5",
        large ? "py-24" : "py-10 px-6",
      )}
    >
      <FileUp className={cn("mb-3 text-muted-foreground", large ? "h-12 w-12" : "h-6 w-6")} />
      <p className={cn("font-medium", large ? "text-lg" : "text-sm")}>{label}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function ImportComptaButton({ onFile }: { onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => ref.current?.click()}>
        <Upload className="mr-2 h-4 w-4" /> Importer un CSV
      </Button>
      <input
        ref={ref}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </>
  );
}

// ---------------- Dashboard ----------------

function MonthDashboard({ tx }: { tx: Transaction[] }) {
  const totalRec = tx.reduce((a, t) => a + t.recettes, 0);
  const totalDep = tx.reduce((a, t) => a + t.depenses, 0);
  const solde = totalRec - totalDep;

  const byCat = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tx) {
      if (t.depenses > 0 && t.categorie) {
        map.set(t.categorie, (map.get(t.categorie) ?? 0) + t.depenses);
      }
    }
    return Array.from(map, ([categorie, montant]) => ({ categorie, montant }))
      .sort((a, b) => b.montant - a.montant);
  }, [tx]);

  const donut = [
    { name: "Dépenses", value: totalDep, color: "#f43f5e" },
    { name: "Reste", value: Math.max(0, solde), color: "#10b981" },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Synthèse du mois</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            <div className="relative h-40 w-40 shrink-0">
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={totalRec > 0 ? donut : [{ name: "Aucune donnée", value: 1, color: "#334155" }]}
                    dataKey="value"
                    innerRadius={52}
                    outerRadius={70}
                    stroke="none"
                    startAngle={90}
                    endAngle={-270}
                  >
                    {(totalRec > 0 ? donut : [{ color: "#334155" }]).map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xs text-muted-foreground">Solde</span>
                <span className={cn("text-xl font-bold tabular-nums", solde >= 0 ? "text-emerald-400" : "text-rose-400")}>
                  {fmt(solde)}
                </span>
              </div>
            </div>
            <div className="flex-1 space-y-3">
              <Stat icon={<TrendingUp className="h-4 w-4 text-emerald-400" />} label="Recettes" value={fmt(totalRec)} tone="pos" />
              <Stat icon={<TrendingDown className="h-4 w-4 text-rose-400" />} label="Dépenses" value={fmt(totalDep)} tone="neg" />
              <Separator />
              <Stat icon={<Wallet className="h-4 w-4 text-primary" />} label="Reste à vivre" value={fmt(solde)} tone={solde >= 0 ? "pos" : "neg"} strong />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Dépenses par catégorie</CardTitle>
        </CardHeader>
        <CardContent>
          {byCat.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Aucune dépense catégorisée ce mois.</p>
          ) : (
            <div style={{ height: Math.max(180, byCat.length * 36) }}>
              <ResponsiveContainer>
                <BarChart data={byCat} layout="vertical" margin={{ left: 8, right: 100, top: 4, bottom: 4 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="categorie" width={110}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.04)" }}
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => fmt(v)}
                  />
                  <Bar dataKey="montant" radius={[0, 6, 6, 0]}>
                    {byCat.map((d) => <Cell key={d.categorie} fill={colorFor(d.categorie)} />)}
                    <LabelList
                      dataKey="montant"
                      position="right"
                      formatter={(v: number) => fmt(v)}
                      style={{ fill: "hsl(var(--foreground))", fontSize: 12, fontWeight: 600 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ icon, label, value, tone, strong }: { icon: React.ReactNode; label: string; value: string; tone?: "pos" | "neg"; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">{icon} {label}</div>
      <span className={cn(
        "tabular-nums",
        strong ? "text-base font-semibold" : "text-sm font-medium",
        tone === "pos" && "text-emerald-400",
        tone === "neg" && "text-rose-400",
      )}>{value}</span>
    </div>
  );
}

// ---------------- Workspace : filters + table + add + reconcile ----------------

const CATEGORIES = ["Maison","Voiture","Courses","Carburant","Ecole","École","Divers","Santé","Cadeaux","Vacances/Loisirs","Frais Travail"];
const PAYMENTS = ["CB","Virement","Paypal","Chèque","Espèces"];
const RECONCILIATION_DAY_MS = 86_400_000;
const RECONCILIATION_MAX_DAYS = 7;

function toCents(value: number | string): number {
  const amount = typeof value === "string" ? parseAmount(value) : value;
  return Math.round(Math.abs(amount) * 100);
}

function toTimestamp(iso: string | null): number {
  if (!iso) return NaN;
  const [year, month, day] = iso.split("-").map(Number);
  return year && month && day ? Date.UTC(year, month - 1, day) : NaN;
}

function diffDays(a: string | null, b: string | null): number {
  const aMs = toTimestamp(a);
  const bMs = toTimestamp(b);
  if (Number.isNaN(aMs) || Number.isNaN(bMs)) return Number.POSITIVE_INFINITY;
  return Math.abs(aMs - bMs) / RECONCILIATION_DAY_MS;
}

function normalizeLibelle(value: string): string {
  return cleanBankLibelle(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(paiement|achat|carte|cb|prlv|prelevement|sepa|virement|vir|retrait|dab|ref|id|mandat|mdt)\b/g, " ")
    .replace(/\d+/g, " ")
    .replace(/[^a-z]+/g, " ")
    .trim();
}

function libelleScore(bankLibelle: string, transactionLibelle: string): number {
  const bank = normalizeLibelle(bankLibelle);
  const tx = normalizeLibelle(transactionLibelle);
  if (!bank || !tx) return 0;
  if (bank.includes(tx) || tx.includes(bank)) return 3;
  const bankWords = new Set(bank.split(/\s+/).filter((word) => word.length >= 3));
  const txWords = tx.split(/\s+/).filter((word) => word.length >= 3);
  return txWords.reduce((score, word) => score + (bankWords.has(word) ? 1 : 0), 0);
}

function MonthWorkspace({
  db, setDb, persist, currentMonth, currentYear,
}: {
  db: DBShape;
  setDb: React.Dispatch<React.SetStateAction<DBShape>>;
  persist: (u: (d: DBShape) => DBShape) => void;
  currentMonth: number;
  currentYear: number;
}) {
  const [catFilter, setCatFilter] = useState<string>("all");
  const [pointFilter, setPointFilter] = useState<"all" | "yes" | "no">("all");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [prefill, setPrefill] = useState<Partial<Transaction> | null>(null);
  const [bankLines, setBankLines] = useState<BankLine[]>([]);

  const monthTx = db.transactions.filter((t) => t.year === currentYear && t.month === currentMonth);
  const filtered = monthTx.filter((t) => {
    if (catFilter !== "all" && t.categorie !== catFilter) return false;
    if (pointFilter === "yes" && !t.pointe) return false;
    if (pointFilter === "no" && t.pointe) return false;
    if (search && !t.libelle.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const togglePointage = (id: string) => {
    persist((d) => {
      d.transactions = d.transactions.map((t) => t.id === id ? { ...t, pointe: !t.pointe } : t);
      return d;
    });
  };
  const removeTx = (id: string) => {
    persist((d) => {
      d.transactions = d.transactions.filter((t) => t.id !== id);
      return d;
    });
  };

  // Bank reconciliation
  const handleBankImport = async (file: File) => {
    try {
      const text = await readFileAsText(file);
      const lines = parseBankCSV(text);
      if (!lines.length) {
        toast.error("Aucune ligne détectée dans le relevé");
        return;
      }
      // Pure computation on current db snapshot
      const monthList = db.transactions.filter(
        (t) => t.year === currentYear && t.month === currentMonth,
      );
      const usedIds = new Set<string>();
      const unmatched: BankLine[] = [];

      for (const bl of lines) {
        const bankCents = toCents(bl.montant);
        if (bankCents === 0) continue;

        const candidates = monthList
          .filter((t) => {
            if (usedIds.has(t.id)) return false;
            const txCents = Math.max(toCents(t.recettes), toCents(t.depenses));
            if (txCents === 0 || txCents !== bankCents) return false;
            const days = diffDays(bl.date, t.date);
            if (days > RECONCILIATION_MAX_DAYS) return false;
            return true;
          })
          .map((t) => ({
            t,
            diffDays: diffDays(bl.date, t.date),
            libelleScore: libelleScore(bl.libelle, t.libelle),
          }))
          .sort((a, b) => b.libelleScore - a.libelleScore || a.diffDays - b.diffDays);

        const cand = candidates[0]?.t;
        if (cand) usedIds.add(cand.id);
        else unmatched.push(bl);
      }

      const matched = usedIds.size;
      persist((d) => {
        d.transactions = d.transactions.map((t) =>
          usedIds.has(t.id) ? { ...t, pointe: true } : t,
        );
        return d;
      });
      setBankLines(unmatched);
      toast.success(
        `Rapprochement : ${matched} rapprochée${matched > 1 ? "s" : ""}, ${unmatched.length} manquante${unmatched.length > 1 ? "s" : ""}`,
      );
    } catch (e) {
      toast.error("Erreur : " + (e as Error).message);
    }
  };



  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        {/* Filters */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Rechercher un libellé…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={catFilter} onValueChange={setCatFilter}>
              <SelectTrigger className="w-[170px]"><SelectValue placeholder="Catégorie" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes catégories</SelectItem>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={pointFilter} onValueChange={(v) => setPointFilter(v as "all" | "yes" | "no")}>
              <SelectTrigger className="w-[210px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les transactions</SelectItem>
                <SelectItem value="yes">Pointées uniquement (X)</SelectItem>
                <SelectItem value="no">Non pointées (en attente)</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => { setPrefill(null); setAddOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" /> Ajouter
            </Button>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[70px]">Pointage</TableHead>
                  <TableHead className="w-[100px]">Date</TableHead>
                  <TableHead>Libellé</TableHead>
                  <TableHead className="w-[140px]">Catégorie</TableHead>
                  <TableHead className="w-[110px]">Moyen</TableHead>
                  <TableHead className="w-[110px] text-right">Recettes</TableHead>
                  <TableHead className="w-[110px] text-right">Dépenses</TableHead>
                  <TableHead className="w-[40px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                      Aucune transaction pour ce filtre.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((t) => (
                  <TableRow key={t.id} className="group">
                    <TableCell>
                      <button onClick={() => togglePointage(t.id)} className="flex items-center">
                        {t.pointe ? (
                          <Badge className="gap-1 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border-emerald-500/30">
                            <CheckCircle2 className="h-3 w-3" /> X
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-muted-foreground">
                            <Clock className="h-3 w-3" />
                          </Badge>
                        )}
                      </button>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground tabular-nums">
                      {t.date ? new Date(t.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—"}
                    </TableCell>
                    <TableCell className="font-medium">{t.libelle}</TableCell>
                    <TableCell>
                      {t.categorie ? (
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <Circle className="h-2 w-2 fill-current" style={{ color: colorFor(t.categorie) }} />
                          {t.categorie}
                        </span>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{t.moyenPaiement || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-400">
                      {t.recettes > 0 ? fmt(t.recettes) : ""}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-rose-400">
                      {t.depenses > 0 ? fmt(-t.depenses) : ""}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => removeTx(t.id)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Right column */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Landmark className="h-4 w-4" /> Rapprochement bancaire
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <DropZone
              onFile={handleBankImport}
              label="Relevé Crédit Mutuel (.csv)"
              hint="Glissez ici pour rapprocher"
            />
            {bankLines.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-rose-400">
                    Transactions manquantes ({bankLines.length})
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => setBankLines([])}>Effacer</Button>
                </div>
                <ScrollArea className="max-h-[400px]">
                  <div className="space-y-2">
                    {bankLines.map((bl, i) => {
                      const cleanLib = cleanBankLibelle(bl.libelle);
                      return (
                        <div key={i} className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium" title={bl.libelle}>
                                {cleanLib || "(sans libellé)"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {bl.date ? new Date(bl.date).toLocaleDateString("fr-FR") : "—"} ·{" "}
                                <span className={bl.montant < 0 ? "text-rose-400" : "text-emerald-400"}>{fmt(bl.montant)}</span>
                              </p>
                            </div>
                            <Button
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              onClick={() => {
                                setPrefill({
                                  date: bl.date,
                                  libelle: cleanLib,
                                  recettes: bl.montant > 0 ? bl.montant : 0,
                                  depenses: bl.montant < 0 ? Math.abs(bl.montant) : 0,
                                });
                                setAddOpen(true);
                              }}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            )}

          </CardContent>
        </Card>
      </div>

      <AddTransactionDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        db={db}
        currentMonth={currentMonth}
        currentYear={currentYear}
        prefill={prefill}
        onSubmit={(tx) => {
          persist((d) => {
            d.transactions.push(tx);
            learnFromTransaction(d, tx);
            return d;
          });
          setAddOpen(false);
          setPrefill(null);
          // Remove from missing list if it matches
          if (prefill) {
            const targetAbs = tx.recettes || tx.depenses;
            setBankLines((prev) =>
              prev.filter((bl) => Math.abs(Math.abs(bl.montant) - targetAbs) >= 0.005),
            );
          }
          toast.success("Transaction ajoutée");
        }}

      />
    </div>
  );
}

// ---------------- Add transaction dialog with autocomplete ----------------

function AddTransactionDialog({
  open, onOpenChange, db, currentMonth, currentYear, prefill, onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  db: DBShape;
  currentMonth: number;
  currentYear: number;
  prefill: Partial<Transaction> | null;
  onSubmit: (tx: Transaction) => void;
}) {
  const [libelle, setLibelle] = useState("");
  const [categorie, setCategorie] = useState("");
  const [moyen, setMoyen] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [recettes, setRecettes] = useState("");
  const [depenses, setDepenses] = useState("");
  const [suggestions, setSuggestions] = useState<{ libelle: string; categorie?: string; moyenPaiement?: string }[]>([]);
  const [showSug, setShowSug] = useState(false);

  useEffect(() => {
    if (open) {
      setLibelle(prefill?.libelle ?? "");
      setCategorie(prefill?.categorie ?? "");
      setMoyen(prefill?.moyenPaiement ?? "");
      setDateStr(prefill?.date ?? `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`);
      setRecettes(prefill?.recettes ? String(prefill.recettes) : "");
      setDepenses(prefill?.depenses ? String(prefill.depenses) : "");
      setShowSug(false);
    }
  }, [open, prefill, currentMonth, currentYear]);

  const onLibelleChange = (v: string) => {
    setLibelle(v);
    const sug = autocomplete(db, v);
    setSuggestions(sug);
    setShowSug(sug.length > 0);
  };

  const pickSuggestion = (s: { libelle: string; categorie?: string; moyenPaiement?: string }) => {
    setLibelle(s.libelle);
    if (s.categorie) setCategorie(s.categorie);
    if (s.moyenPaiement) setMoyen(s.moyenPaiement);
    else {
      // Fallback: check tx history
      const guess = suggestFromLibelle(db, s.libelle);
      if (guess) {
        if (!s.categorie && guess.categorie) setCategorie(guess.categorie);
        if (!s.moyenPaiement && guess.moyenPaiement) setMoyen(guess.moyenPaiement);
      }
    }
    setShowSug(false);
  };

  const submit = () => {
    if (!libelle.trim()) { toast.error("Libellé requis"); return; }
    const rec = parseFloat(recettes.replace(",", ".")) || 0;
    const dep = Math.abs(parseFloat(depenses.replace(",", ".")) || 0);
    if (rec === 0 && dep === 0) { toast.error("Montant requis"); return; }
    // derive month/year from dateStr if valid
    let y = currentYear, mo = currentMonth;
    if (dateStr) {
      const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) { y = +m[1]; mo = +m[2]; }
    }
    onSubmit({
      id: crypto.randomUUID(),
      year: y, month: mo,
      date: dateStr || null,
      libelle: libelle.trim(),
      categorie,
      recettes: rec,
      depenses: dep,
      moyenPaiement: moyen,
      pointe: false,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Ajouter une transaction</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="relative">
            <Label className="mb-1.5 block text-xs">Libellé</Label>
            <Input
              value={libelle}
              onChange={(e) => onLibelleChange(e.target.value)}
              onFocus={() => libelle && onLibelleChange(libelle)}
              onBlur={() => setTimeout(() => setShowSug(false), 150)}
              placeholder="Ex: Super U (Lexus)"
              autoFocus
            />
            {showSug && suggestions.length > 0 && (
              <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-lg">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="font-medium">{s.libelle}</span>
                    <span className="text-xs text-muted-foreground">
                      {s.categorie ?? "—"} · {s.moyenPaiement ?? "—"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block text-xs">Date</Label>
              <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Moyen de paiement</Label>
              <Select value={moyen} onValueChange={setMoyen}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {PAYMENTS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block text-xs">Catégorie</Label>
            <Select value={categorie} onValueChange={setCategorie}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block text-xs">Recettes (€)</Label>
              <Input inputMode="decimal" value={recettes} onChange={(e) => setRecettes(e.target.value)} placeholder="0,00" />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Dépenses (€)</Label>
              <Input inputMode="decimal" value={depenses} onChange={(e) => setDepenses(e.target.value)} placeholder="0,00" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={submit}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
