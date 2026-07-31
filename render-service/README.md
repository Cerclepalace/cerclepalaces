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

## Alternative : Railway (sans ligne de commande)
1. https://railway.app → **Login with GitHub**.
2. **New Project** → **Deploy from GitHub repo** → choisis le repo du projet.
3. Dans **Settings → Root Directory**, mets `render-service`.
4. Dans **Variables**, ajoute `RENDER_SERVICE_SECRET` = ta chaîne aléatoire.
5. **Settings → Networking → Generate Domain** : tu obtiens l'URL à coller dans
   `RENDER_SERVICE_URL`.

## Coût indicatif
Machine `performance-2x` (4 Go) en veille automatique : environ 5 à 15 $/mois selon
le volume encodé. Aucun coût à la minute de vidéo.
