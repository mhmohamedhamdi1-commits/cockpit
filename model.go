package main

// Modèle de données. Chaque struct = un onglet du classeur Finances_Data.xlsx.
// Tags : json = nom côté interface, x = en-tête de colonne Excel,
// k = type de colonne (date, money, rate, int), w = largeur de colonne.

type Tx struct {
	ID         int     `json:"id" x:"ID" k:"int" w:"7"`
	Date       string  `json:"date" x:"Date" k:"date" w:"12"`
	Activite   string  `json:"activite" x:"Activité" w:"12"`
	Sens       string  `json:"sens" x:"Sens" w:"9"`
	Categorie  string  `json:"categorie" x:"Catégorie" w:"24"`
	Detail     string  `json:"detail" x:"Détail" w:"18"`
	Libelle    string  `json:"libelle" x:"Libellé" w:"34"`
	Montant    float64 `json:"montant" x:"Montant" k:"money" w:"13"`
	Devise     string  `json:"devise" x:"Devise" w:"8"`
	Taux       float64 `json:"taux" x:"Taux vers EUR" k:"rate" w:"13"`
	MontantEUR float64 `json:"montantEur" x:"Montant EUR" k:"money" w:"13"`
	Nature     string  `json:"nature" x:"Nature" w:"14"`
	Tiers      string  `json:"tiers" x:"Tiers" w:"22"`
	Lot        string  `json:"lot" x:"Lot" w:"28"`
	Periode    string  `json:"periode" x:"Période" w:"10"`
	Ref        string  `json:"ref" x:"Réf" w:"14"`
	Note       string  `json:"note" x:"Note" w:"30"`
}

type Category struct {
	Activite  string `json:"activite" x:"Activité" w:"12"`
	Sens      string `json:"sens" x:"Sens" w:"9"`
	Categorie string `json:"categorie" x:"Catégorie" w:"28"`
	Groupe    string `json:"groupe" x:"Groupe" w:"26"`
	Nature    string `json:"nature" x:"Nature par défaut" w:"18"`
	Icone     string `json:"icone" x:"Icône" w:"8"`
}

type Lot struct {
	ID    int     `json:"id" x:"ID" k:"int" w:"7"`
	Code  string  `json:"code" x:"Code" w:"8"`
	Nom   string  `json:"nom" x:"Nom du lot" w:"32"`
	Loyer float64 `json:"loyer" x:"Loyer de référence (MAD)" k:"money" w:"24"`
}

type Tenant struct {
	ID      int     `json:"id" x:"ID" k:"int" w:"7"`
	Lot     string  `json:"lot" x:"Lot" w:"30"`
	Nom     string  `json:"nom" x:"Locataire" w:"26"`
	Loyer   float64 `json:"loyer" x:"Loyer (MAD)" k:"money" w:"12"`
	Charges float64 `json:"charges" x:"Charges forfait (MAD)" k:"money" w:"20"`
	Entree  string  `json:"entree" x:"Date entrée" k:"date" w:"13"`
	Sortie  string  `json:"sortie" x:"Date sortie" k:"date" w:"13"`
	Caution float64 `json:"caution" x:"Caution (MAD)" k:"money" w:"14"`
	Contact string  `json:"contact" x:"Contact" w:"18"`
	Metier  string  `json:"metier" x:"Métier" w:"24"`
	Note    string  `json:"note" x:"Note" w:"40"`
}

type Client struct {
	ID     int     `json:"id" x:"ID" k:"int" w:"7"`
	Nom    string  `json:"nom" x:"Client" w:"28"`
	Devise string  `json:"devise" x:"Devise" w:"8"`
	TJM    float64 `json:"tjm" x:"TJM" k:"money" w:"10"`
	TVA    float64 `json:"tva" x:"TVA" k:"rate" w:"8"`
	Micro  string  `json:"micro" x:"Compte dans la micro (Oui/Non)" w:"28"`
	Note   string  `json:"note" x:"Note" w:"30"`
}

type Invoice struct {
	ID       int     `json:"id" x:"ID" k:"int" w:"7"`
	Numero   string  `json:"numero" x:"N° facture" w:"13"`
	Client   string  `json:"client" x:"Client" w:"26"`
	Periode  string  `json:"periode" x:"Période" w:"10"`
	Jours    float64 `json:"jours" x:"Jours" k:"money" w:"8"`
	TJM      float64 `json:"tjm" x:"TJM" k:"money" w:"10"`
	Devise   string  `json:"devise" x:"Devise" w:"8"`
	HT       float64 `json:"ht" x:"Montant HT" k:"money" w:"14"`
	TVA      float64 `json:"tva" x:"TVA" k:"rate" w:"8"`
	TTC      float64 `json:"ttc" x:"Montant TTC" k:"money" w:"14"`
	Emission string  `json:"emission" x:"Date facture" k:"date" w:"13"`
	Statut   string  `json:"statut" x:"Statut" w:"12"`
	Paiement string  `json:"paiement" x:"Date paiement" k:"date" w:"14"`
	Note     string  `json:"note" x:"Note" w:"30"`
}

type Recurring struct {
	ID        int     `json:"id" x:"ID" k:"int" w:"7"`
	Libelle   string  `json:"libelle" x:"Libellé" w:"30"`
	Activite  string  `json:"activite" x:"Activité" w:"12"`
	Sens      string  `json:"sens" x:"Sens" w:"9"`
	Categorie string  `json:"categorie" x:"Catégorie" w:"24"`
	Montant   float64 `json:"montant" x:"Montant" k:"money" w:"12"`
	Devise    string  `json:"devise" x:"Devise" w:"8"`
	Jour      int     `json:"jour" x:"Jour du mois" k:"int" w:"12"`
	Debut     string  `json:"debut" x:"Début" k:"date" w:"12"`
	Fin       string  `json:"fin" x:"Fin" k:"date" w:"12"`
	Actif     string  `json:"actif" x:"Actif (Oui/Non)" w:"14"`
	Nature    string  `json:"nature" x:"Nature" w:"14"`
	Tiers     string  `json:"tiers" x:"Tiers" w:"20"`
	Lot       string  `json:"lot" x:"Lot" w:"24"`
}

type Account struct {
	ID     int    `json:"id" x:"ID" k:"int" w:"7"`
	Nom    string `json:"nom" x:"Compte" w:"30"`
	Devise string `json:"devise" x:"Devise" w:"8"`
	Dispo  string `json:"dispo" x:"Disponible (Oui/Non)" w:"20"`
	Ordre  int    `json:"ordre" x:"Ordre" k:"int" w:"8"`
}

type Snapshot struct {
	ID       int     `json:"id" x:"ID" k:"int" w:"7"`
	Date     string  `json:"date" x:"Date" k:"date" w:"12"`
	Compte   string  `json:"compte" x:"Compte" w:"30"`
	Solde    float64 `json:"solde" x:"Solde" k:"money" w:"14"`
	Devise   string  `json:"devise" x:"Devise" w:"8"`
	SoldeEUR float64 `json:"soldeEur" x:"Solde EUR" k:"money" w:"14"`
}

type Param struct {
	Cle     string `json:"cle" x:"Paramètre" w:"22"`
	Valeur  string `json:"valeur" x:"Valeur" w:"16"`
	Libelle string `json:"libelle" x:"Description" w:"60"`
}

type Data struct {
	Tx         []Tx        `json:"tx"`
	Categories []Category  `json:"categories"`
	Lots       []Lot       `json:"lots"`
	Tenants    []Tenant    `json:"tenants"`
	Clients    []Client    `json:"clients"`
	Invoices   []Invoice   `json:"invoices"`
	Recurring  []Recurring `json:"recurring"`
	Accounts   []Account   `json:"accounts"`
	Snapshots  []Snapshot  `json:"snapshots"`
	Params     []Param     `json:"params"`
}

// ---- accès à l'ID (pour upsert générique) ----
func (t *Tx) id() *int        { return &t.ID }
func (t *Lot) id() *int       { return &t.ID }
func (t *Tenant) id() *int    { return &t.ID }
func (t *Client) id() *int    { return &t.ID }
func (t *Invoice) id() *int   { return &t.ID }
func (t *Recurring) id() *int { return &t.ID }
func (t *Account) id() *int   { return &t.ID }
func (t *Snapshot) id() *int  { return &t.ID }

// Feuilles du classeur
const (
	shTx    = "Transactions"
	shCat   = "Catégories"
	shLots  = "Lots"
	shTen   = "Locataires"
	shCli   = "Clients"
	shInv   = "Factures"
	shRec   = "Récurrents"
	shAcc   = "Comptes"
	shSnap  = "Relevés"
	shParam = "Paramètres"
	shRead  = "Lisez-moi"
)

var defaultParams = []Param{
	{"taux_mad_eur", "0.093", "Taux de change : 1 MAD = x EUR (sert à convertir les opérations en MAD)"},
	{"part_immo", "0.67", "Ma part du projet immobilier (Amal 1), entre 0 et 1"},
	{"micro_debut", "2027-01-01", "Début de la micro-entreprise : seuls les CA à partir de cette date comptent pour les plafonds (le 1er exercice est proratisé au nombre de jours)"},
	{"seuil_micro", "83600", "Plafond de CA annuel HT du régime micro-BNC (2026-2028)"},
	{"seuil_tva", "37500", "Seuil de franchise en base de TVA (prestations de services)"},
	{"seuil_tva_maj", "41250", "Seuil majoré de TVA (TVA due immédiatement au-delà)"},
	{"taux_cotis", "0.256", "Cotisations sociales micro-BNC (% du CA encaissé)"},
	{"taux_cfp", "0.002", "Contribution à la formation professionnelle (% du CA)"},
	{"taux_provision", "0.40", "Part de chaque encaissement freelance à mettre de côté (cotisations + impôt) — estimation à valider avec un expert-comptable"},
	{"nom", "Mohamed", "Prénom affiché dans l'application"},
}

func seedCategories() []Category {
	type c = Category
	var out []c
	add := func(act, sens, groupe, nature string, items ...string) {
		for _, it := range items {
			// format "Icône|Nom"
			icon, name := "•", it
			for i, r := range it {
				if r == '|' {
					icon, name = it[:i], it[i+1:]
					break
				}
			}
			out = append(out, c{act, sens, name, groupe, nature, icon})
		}
	}
	// --- Perso : dépenses
	add("Perso", "Dépense", "Logement", "Courant", "🏠|Loyer", "💡|Charges", "🛡️|Assurance Habitation", "🔧|Entretien & Bricolage")
	add("Perso", "Dépense", "Mobilité", "Courant", "🚇|Transports en Commun", "⛽|Carburant", "🛠️|Entretien Véhicule", "🚘|Assurance Auto", "🅿️|Stationnement", "🛣️|Autoroute")
	add("Perso", "Dépense", "Alimentation", "Courant", "🛒|Courses", "🍴|Restaurant", "☕|Café")
	add("Perso", "Dépense", "Santé & Bien-être", "Courant", "💊|Soins Médicaux", "🏥|Assurance Santé", "💈|Soin & Coiffure", "🏃|Activité Sportive")
	add("Perso", "Dépense", "Shopping & Loisirs", "Courant", "👕|Vêtements", "🎬|Loisirs & Divertissements")
	add("Perso", "Dépense", "Télécoms & abonnements", "Courant", "📱|Mobile", "🌐|Internet", "💻|Abonnements Numériques")
	add("Perso", "Dépense", "Cadeaux & dons", "Courant", "🎁|Cadeaux", "🤲|Dons")
	add("Perso", "Dépense", "Impôts & frais admin", "Courant", "🏛️|Impôts", "🧾|Taxes", "🏦|Frais Bancaires", "⚠️|Amendes")
	add("Perso", "Dépense", "Voyages", "Courant", "✈️|Voyages")
	add("Perso", "Dépense", "Équipement", "Courant", "☎️|Téléphone", "🖥️|Ordinateur", "🧺|Electroménager")
	add("Perso", "Dépense", "Exceptionnel", "Courant", "💍|Mariage", "🛋️|Meubles", "🧱|Travaux Immeuble", "🚙|Acquisition voiture")
	add("Perso", "Dépense", "Projets", "Courant", "💼|Entreprise", "📦|eCommerce")
	add("Perso", "Dépense", "Investissements", "Investissement", "📈|La bourse", "🏗️|Immobilier")
	add("Perso", "Dépense", "Autres", "Courant", "❓|Autres")
	// --- Perso : revenus
	add("Perso", "Revenu", "Revenus", "Courant", "💶|Salaire & primes", "📈|Revenu boursier", "🏘️|Revenu immobilier", "📦|E-commerce", "⚽|Football", "➕|Autres")
	add("Perso", "Revenu", "Financement", "Financement", "🏘️|Distribution Amal 1")
	// --- Freelance
	add("Freelance", "Revenu", "Revenus", "Courant", "🧾|Prestations")
	add("Freelance", "Revenu", "Financement", "Financement", "🧾|TVA collectée")
	add("Freelance", "Dépense", "Charges", "Courant", "🏛️|Cotisations URSSAF", "🏛️|CFE & taxes", "💻|Logiciels & abonnements", "🖥️|Matériel", "📒|Comptable & banque", "🚆|Déplacements pro", "➖|Autres frais pro")
	add("Freelance", "Dépense", "Financement", "Financement", "🧾|TVA reversée")
	// --- Immobilier
	add("Immobilier", "Revenu", "Revenus", "Courant", "🏠|Loyer", "💡|Charges refacturées")
	add("Immobilier", "Revenu", "Investissement", "Investissement", "🔁|Remboursement travaux")
	add("Immobilier", "Revenu", "Financement", "Financement", "💰|Apport en capital", "🤝|Prêt reçu", "🔑|Caution reçue")
	add("Immobilier", "Dépense", "Exploitation", "Courant", "💡|Eau & électricité", "🧹|Ménage", "🔧|Entretien & bricolage", "🧑‍💼|Agence & commissions", "🧾|Taxes", "🏦|Frais bancaires", "🚗|Déplacements", "📄|Administratif")
	add("Immobilier", "Dépense", "Investissement", "Investissement", "🧱|Travaux", "🏢|Acquisition")
	add("Immobilier", "Dépense", "Financement", "Financement", "🤝|Remboursement prêt", "🔑|Restitution caution", "💸|Distribution aux associés")
	return out
}
