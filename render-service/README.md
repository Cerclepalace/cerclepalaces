# NeonCut — service de rendu ffmpeg

Ce dossier contient le serveur qui exécute ffmpeg **en natif**, à la place du navigateur.
Il est indépendant de l'app : tu le déploies une fois, puis tu colles son URL dans l'app.

## Pourquoi un service séparé

Le backend de l'app tourne sur un runtime "edge" (Cloudflare Workers) : pas de binaire
natif, pas de processus enfant, pas de système de fichiers réel → ffmpeg y est impossible.
Les edge functions Supabase ont la même limite, plus un plafond de ~150 s.
Un petit conteneur Docker avec ffmpeg règle les deux problèmes, sans limite de durée.

## Déploiement sur Fly.io — pas à pas

### 1. Créer le compte
1. Va sur https://fly.io/app/sign-up
2. Inscris-toi (email + mot de passe, ou "Sign up with GitHub").
3. Valide l'email reçu.
4. Fly demande une carte bancaire pour activer le déploiement : menu **Billing** →
   **Add payment method**. Il n'y a pas de prélèvement tant que tu restes petit
   (la machine se met en veille automatiquement quand personne n'encode).

### 2. Installer l'outil en ligne de commande
Ouvre un terminal sur ton ordinateur.

- **macOS / Linux** :
  ```bash
  curl -L https://fly.io/install.sh | sh
  ```
- **Windows (PowerShell)** :
  ```powershell
  pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"
  ```

Puis connecte-toi :
```bash
fly auth login
```
(un onglet navigateur s'ouvre, clique **Continue as ...**)

### 3. Récupérer ce dossier
Télécharge le code du projet (bouton **GitHub** / **Export** dans Lovable), puis dans le
terminal :
```bash
cd chemin/vers/le/projet/render-service
```

### 4. Créer l'application Fly
```bash
fly launch --no-deploy --copy-config --name neoncut-render --region cdg
```
Réponds :
- « Would you like to tweak these settings? » → **No** (`n`)
- Si le nom `neoncut-render` est déjà pris, relance avec un autre nom
  (`--name neoncut-render-tonpseudo`) et note-le.

### 5. Définir le mot de passe partagé
Choisis une longue chaîne aléatoire (au moins 32 caractères). Exemple pour en générer une :
```bash
openssl rand -hex 32
```
Copie le résultat, puis :
```bash
fly secrets set RENDER_SERVICE_SECRET=colle_ici_la_chaine
```

### 6. Déployer
```bash
fly deploy
```
À la fin, Fly affiche l'URL, du type `https://neoncut-render.fly.dev`.
Vérifie qu'elle répond :
```bash
curl https://neoncut-render.fly.dev/health
# {"ok":true}
```

### 7. Brancher l'app
Dans Lovable, ajoute deux secrets (l'agent te les demandera) :
- `RENDER_SERVICE_URL` = `https://neoncut-render.fly.dev` (sans slash final)
- `RENDER_SERVICE_SECRET` = **exactement** la même chaîne qu'à l'étape 5

Puis publie l'app. C'est tout : sur mobile, le rendu part automatiquement sur le serveur.

## Alternative : Railway (100 % depuis un téléphone, sans terminal)

1. **Envoyer le code sur GitHub** — dans Lovable : bouton **GitHub** en haut à
   droite → **Connect to GitHub** → autoriser → **Create repository**.
2. **Créer le compte Railway** — https://railway.com → **Login with GitHub**
   (même compte qu'à l'étape 1) → autoriser.
3. **Ajouter une carte** — avatar en haut à droite → **Account settings** →
   **Billing** → **Add payment method**. Sans carte, Railway limite le projet à
   500 Mo de RAM, insuffisant pour ffmpeg.
4. **Créer le service** — bouton **New Project** → **Deploy from GitHub repo** →
   **Configure GitHub App** si le repo n'apparaît pas → choisir le repo du projet.
5. **Pointer sur le bon dossier** — cliquer sur la carte du service → onglet
   **Settings** → section **Source** → **Root Directory** = `render-service`.
   Railway détecte alors le `Dockerfile` et le `railway.json` tout seuls.
6. **Ajouter le mot de passe partagé** — onglet **Variables** → **New Variable** :
   - nom : `RENDER_SERVICE_SECRET`
   - valeur : une longue chaîne aléatoire (≥ 32 caractères), à conserver.
   Ne pas définir `PORT` : Railway l'injecte, le serveur le lit déjà.
7. **Déployer** — onglet **Deployments** → **Deploy**. Attendre le statut
   **Active** (3 à 6 min au premier build, ffmpeg est installé dans l'image).
8. **Obtenir l'URL** — **Settings** → **Networking** → **Generate Domain** →
   port `8080`. On obtient `https://<nom>.up.railway.app`.
9. **Vérifier** — ouvrir `https://<nom>.up.railway.app/health` dans le navigateur :
   la page doit afficher `{"ok":true}`.
10. **Brancher l'app** — dans Lovable, renseigner les deux secrets :
    - `RENDER_SERVICE_URL` = l'URL de l'étape 8, **sans slash final**
    - `RENDER_SERVICE_SECRET` = **exactement** la chaîne de l'étape 6
    Puis publier l'app.

Chaque nouveau push sur GitHub redéploie le service automatiquement.


## Coût indicatif
Machine `performance-2x` (4 Go) en veille automatique : environ 5 à 15 $/mois selon
le volume encodé. Aucun coût à la minute de vidéo.
