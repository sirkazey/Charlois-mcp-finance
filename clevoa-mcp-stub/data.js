// Jeu de données de l'univers canin : élevages, concours d'agility, croquettes Royal Canin Pro.
// Deux collaborateurs aux droits différents pour démontrer l'impersonation : Marie (DAF, tout voit) et Paul (commercial).
export const USERS = {
  "marie.dupont@charlois.com": { name: "Marie Dupont", role: "DAF", sageLogin: "MDUPONT", sageKey: "SYR-MARIE-2026", myreportKey: "MR-MARIE-2026", confidentiel: true, achats: true },
  "paul.martin@charlois.com": { name: "Paul Martin", role: "Commercial", sageLogin: "PMARTIN", sageKey: "SYR-PAUL-2026", myreportKey: "MR-PAUL-2026", confidentiel: false, achats: false },
};

// ---------- Salesforce ----------
const F = (name, type, label, extra = {}) => ({ name, type, label, ...extra });
export const SF = {
  Lead: { label: "Piste (éleveur prospect)", fields: [F("Id", "id", "ID"), F("Name", "string", "Nom"), F("Company", "string", "Élevage"), F("Email", "email", "Email"), F("Status", "picklist", "Statut"), F("Race__c", "picklist", "Race principale"), F("Inscrits__c", "double", "Chiens inscrits au LOF"), F("OwnerId", "reference", "Propriétaire", { referenceTo: ["User"] })],
    records: [
      { Id: "00Q1", Name: "Sophie Lenoir", Company: "Élevage des Crocs de Bourgogne", Email: "contact@crocs-bourgogne.fr", Status: "Working", Race__c: "Berger Allemand", Inscrits__c: 38, OwnerId: "005P" },
      { Id: "00Q2", Name: "Karim Haddad", Company: "Domaine du Border Fou", Email: "karim@borderfou.fr", Status: "Open", Race__c: "Border Collie", Inscrits__c: 22, OwnerId: "005P" },
      { Id: "00Q3", Name: "Lucie Perrin", Company: "Les Goldens de la Loire", Email: "lucie@goldens-loire.fr", Status: "Qualified", Race__c: "Golden Retriever", Inscrits__c: 51, OwnerId: "005P" },
      { Id: "00Q4", Name: "Antoine Roux", Company: "Malinois du Haut-Doubs", Email: "a.roux@malinois-hd.fr", Status: "Open", Race__c: "Berger Belge Malinois", Inscrits__c: 17, OwnerId: "005M" },
    ] },
  Account: { label: "Compte (élevage client)", fields: [F("Id", "id", "ID"), F("Name", "string", "Nom"), F("Industry", "picklist", "Secteur"), F("Race__c", "picklist", "Race principale"), F("AnnualRevenue", "currency", "CA annuel"), F("BillingCity", "string", "Ville")],
    records: [
      { Id: "0011", Name: "Élevage des Crocs de Bourgogne", Industry: "Élevage canin", Race__c: "Berger Allemand", AnnualRevenue: 310000, BillingCity: "Beaune" },
      { Id: "0012", Name: "Les Goldens de la Loire", Industry: "Élevage canin", Race__c: "Golden Retriever", AnnualRevenue: 265000, BillingCity: "Angers" },
      { Id: "0013", Name: "Club d'Agility Rhône-Alpes", Industry: "Association", Race__c: "Toutes races", AnnualRevenue: 48000, BillingCity: "Lyon" },
    ] },
  Opportunity: { label: "Opportunité (stand sur concours)", fields: [F("Id", "id", "ID"), F("Name", "string", "Nom"), F("AccountId", "reference", "Compte", { referenceTo: ["Account"] }), F("Amount", "currency", "Montant"), F("StageName", "picklist", "Étape"), F("CloseDate", "date", "Date de clôture"), F("Concours__c", "string", "Concours"), F("Inscrits__c", "double", "Inscrits attendus"), F("OwnerId", "reference", "Propriétaire", { referenceTo: ["User"] })],
    records: [
      { Id: "0061", Name: "Stand Agility Cup Lyon 2026", AccountId: "0013", Amount: 12000, StageName: "Negotiation/Review", CloseDate: "2026-11-02", Concours__c: "Agility Cup Lyon", Inscrits__c: 239, OwnerId: "005P" },
      { Id: "0062", Name: "Stand Trophée de l'Ouest Nantes", AccountId: "0013", Amount: 8500, StageName: "Proposal/Price Quote", CloseDate: "2026-11-20", Concours__c: "Trophée de l'Ouest", Inscrits__c: 209, OwnerId: "005P" },
      { Id: "0063", Name: "Stand Open du Sud Montpellier 2027", AccountId: "0013", Amount: 15500, StageName: "Prospecting", CloseDate: "2027-01-15", Concours__c: "Open du Sud", Inscrits__c: 156, OwnerId: "005M" },
      { Id: "0064", Name: "Partenariat croquettes Goldens de la Loire", AccountId: "0012", Amount: 42000, StageName: "Closed Won", CloseDate: "2026-09-12", Concours__c: "", Inscrits__c: 0, OwnerId: "005M" },
    ] },
  Contact: { label: "Contact", fields: [F("Id", "id", "ID"), F("Name", "string", "Nom"), F("AccountId", "reference", "Compte", { referenceTo: ["Account"] }), F("Email", "email", "Email"), F("Title", "string", "Fonction")],
    records: [{ Id: "0031", Name: "Sophie Lenoir", AccountId: "0011", Email: "contact@crocs-bourgogne.fr", Title: "Gérante" }, { Id: "0032", Name: "Lucie Perrin", AccountId: "0012", Email: "lucie@goldens-loire.fr", Title: "Éleveuse" }] },
  User: { label: "Utilisateur", fields: [F("Id", "id", "ID"), F("Name", "string", "Nom"), F("Email", "email", "Email")],
    records: [{ Id: "005M", Name: "Marie Dupont", Email: "marie.dupont@charlois.com" }, { Id: "005P", Name: "Paul Martin", Email: "paul.martin@charlois.com" }] },
};

// ---------- Sage X3 24R1 (représentations Syracuse) ----------
const P = (name, type, title) => [name, { $type: `application/x-${type}`, $title: title }];
export const SAGE = {
  YFAC: { title: "Factures clients croquettes (spécifique Charlois)", restricted: false, props: [P("NUM", "string", "N° facture"), P("BPR", "string", "Client"), P("BPRNAM", "string", "Raison sociale"), P("ACCDAT", "date", "Date comptable"), P("DUDDAT", "date", "Échéance"), P("AMTATI", "decimal", "Montant TTC"), P("AXE_RACE", "string", "Axe analytique race"), P("AXE_SITE", "string", "Axe analytique site"), P("PAYSTA", "string", "Statut règlement")],
    rows: [
      { NUM: "YFAC-2026-0184", BPR: "C0001", BPRNAM: "Élevage des Crocs de Bourgogne", ACCDAT: "2026-08-14", DUDDAT: "2026-09-14", AMTATI: 6420.5, AXE_RACE: "BERGER_ALL", AXE_SITE: "BEAUNE", PAYSTA: "Retard" },
      { NUM: "YFAC-2026-0201", BPR: "C0001", BPRNAM: "Élevage des Crocs de Bourgogne", ACCDAT: "2026-09-10", DUDDAT: "2026-10-10", AMTATI: 5890, AXE_RACE: "BERGER_ALL", AXE_SITE: "BEAUNE", PAYSTA: "Retard" },
      { NUM: "YFAC-2026-0215", BPR: "C0002", BPRNAM: "Les Goldens de la Loire", ACCDAT: "2026-09-28", DUDDAT: "2026-10-28", AMTATI: 7310, AXE_RACE: "GOLDEN", AXE_SITE: "ANGERS", PAYSTA: "Réglé" },
      { NUM: "YFAC-2026-0233", BPR: "C0003", BPRNAM: "Domaine du Border Fou", ACCDAT: "2026-10-05", DUDDAT: "2026-11-05", AMTATI: 3980, AXE_RACE: "BORDER", AXE_SITE: "LYON", PAYSTA: "À échoir" },
    ] },
  ZVENTE: { title: "Ventes stands et accessoires (spécifique Charlois)", restricted: false, props: [P("SOHNUM", "string", "N° commande"), P("BPCORD", "string", "Client"), P("ORDDAT", "date", "Date"), P("CONCOURS", "string", "Concours"), P("ORDINVATI", "decimal", "Montant TTC"), P("AXE_RACE", "string", "Axe analytique race")],
    rows: [
      { SOHNUM: "ZV-000123", BPCORD: "C0004", ORDDAT: "2026-10-15", CONCOURS: "Agility Cup Lyon", ORDINVATI: 12000, AXE_RACE: "MULTI" },
      { SOHNUM: "ZV-000124", BPCORD: "C0002", ORDDAT: "2026-10-18", CONCOURS: "", ORDINVATI: 1540, AXE_RACE: "GOLDEN" },
      { SOHNUM: "ZV-000125", BPCORD: "C0003", ORDDAT: "2026-10-20", CONCOURS: "Trophée de l'Ouest", ORDINVATI: 8500, AXE_RACE: "BORDER" },
    ] },
  BPCUSTOMER: { title: "Clients", restricted: false, props: [P("BPCNUM", "string", "Code client"), P("BPCNAM", "string", "Raison sociale"), P("CUR", "string", "Devise"), P("RACE_PRINC", "string", "Race principale")],
    rows: [{ BPCNUM: "C0001", BPCNAM: "Élevage des Crocs de Bourgogne", CUR: "EUR", RACE_PRINC: "Berger Allemand" }, { BPCNUM: "C0002", BPCNAM: "Les Goldens de la Loire", CUR: "EUR", RACE_PRINC: "Golden Retriever" }, { BPCNUM: "C0003", BPCNAM: "Domaine du Border Fou", CUR: "EUR", RACE_PRINC: "Border Collie" }, { BPCNUM: "C0004", BPCNAM: "Club d'Agility Rhône-Alpes", CUR: "EUR", RACE_PRINC: "Toutes races" }] },
  PINVOICE: { title: "Factures fournisseurs (achats)", restricted: true, props: [P("NUM", "string", "N° facture"), P("BPSNUM", "string", "Fournisseur"), P("BPSNAM", "string", "Raison sociale"), P("ACCDAT", "date", "Date"), P("DUDDAT", "date", "Échéance"), P("AMTATI", "decimal", "Montant TTC"), P("PAYSTA", "string", "Statut règlement"), P("AXE_RACE", "string", "Axe analytique race")],
    rows: [
      { NUM: "PINV-2026-0912", BPSNUM: "S0001", BPSNAM: "Royal Canin Pro", ACCDAT: "2026-10-15", DUDDAT: "2026-11-15", AMTATI: 24300, PAYSTA: "À échoir", AXE_RACE: "MULTI" },
      { NUM: "PINV-2026-0871", BPSNUM: "S0001", BPSNAM: "Royal Canin Pro", ACCDAT: "2026-09-15", DUDDAT: "2026-10-15", AMTATI: 22150, PAYSTA: "Retard", AXE_RACE: "MULTI" },
      { NUM: "PINV-2026-0880", BPSNUM: "S0002", BPSNAM: "Clinique Vétérinaire des Ducs", ACCDAT: "2026-09-22", DUDDAT: "2026-10-22", AMTATI: 3100, PAYSTA: "Réglé", AXE_RACE: "BERGER_ALL" },
    ] },
  GACCENTRY: { title: "Écritures comptables", restricted: true, props: [P("NUM", "string", "N° pièce"), P("ACCDAT", "date", "Date"), P("ACC", "string", "Compte"), P("DES", "string", "Libellé"), P("AMTDEB", "decimal", "Débit"), P("AMTCDT", "decimal", "Crédit"), P("AXE_RACE", "string", "Axe analytique race")],
    rows: [{ NUM: "GA-2026-10-0441", ACCDAT: "2026-10-15", ACC: "601100", DES: "Achat croquettes Royal Canin Pro", AMTDEB: 20250, AMTCDT: 0, AXE_RACE: "MULTI" }, { NUM: "GA-2026-10-0442", ACCDAT: "2026-10-15", ACC: "401000", DES: "Royal Canin Pro", AMTDEB: 0, AMTCDT: 24300, AXE_RACE: "MULTI" }] },
};

// ---------- SharePoint (site Finance) et Dropbox : même arborescence, servie depuis ./files ----------
export const DOCS = [
  { id: "01F", path: "Bilans", folder: true },
  { id: "01A", path: "Bilans/bilan-canin-2025.xlsx", file: "bilan-canin-2025.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  { id: "01B", path: "Bilans/bilan-canin-2024.xlsx", file: "bilan-canin-2024.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  { id: "01G", path: "Concours", folder: true },
  { id: "01C", path: "Concours/podium-agility-2025.png", file: "podium-agility-2025.png", mime: "image/png" },
  { id: "01D", path: "Concours/podium-beaute-2024.png", file: "podium-beaute-2024.png", mime: "image/png" },
  { id: "01E", path: "Concours/inscrits-agility-2026.csv", file: "inscrits-agility-2026.csv", mime: "text/csv" },
  { id: "01H", path: "Confidentiel", folder: true, restricted: true },
  { id: "01I", path: "Confidentiel/notes-tresorerie.txt", file: "notes-tresorerie.txt", mime: "text/plain", restricted: true },
];

// ---------- MyReport : synthèses de coûts par race ----------
export const MYREPORT = {
  indicateurs: [{ code: "CA_CROQ", libelle: "CA croquettes" }, { code: "COUT_VETO", libelle: "Coûts vétérinaires" }, { code: "MARGE_RACE", libelle: "Marge par race" }],
  coutsParRace: [
    { race: "Berger Allemand", croquettes: 18420, veterinaire: 4100, concours: 2300, total: 24820 },
    { race: "Border Collie", croquettes: 12210, veterinaire: 2900, concours: 5600, total: 20710 },
    { race: "Golden Retriever", croquettes: 15870, veterinaire: 3650, concours: 1800, total: 21320 },
    { race: "Berger Belge Malinois", croquettes: 9340, veterinaire: 2200, concours: 3100, total: 14640 },
  ],
};
