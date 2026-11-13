---
slug: git-grundlagen
title: Git-Grundlagen
shell: BASH
tags: [git, versionskontrolle, init, add, commit, status, log, diff, branch, switch, merge, konflikt, remote, clone, push, pull, fetch, restore, reset, revert, reflog]
order: 50
---

## Einrichten (einmalig)

```bash
git config --global user.name "Vorname Nachname"
git config --global user.email "du@example.com"
git config --global --list
```

## Die drei Bereiche

```text
Arbeitsverzeichnis --git add--> Staging-Area --git commit--> Repository --git push--> Remote
                   <--------------------- git pull -------------------------------------
```

## Alltag

| Befehl | Bedeutung |
|---|---|
| `git init` | Ordner zum Repository machen |
| `git clone URL [ordner]` | Repository vom Server kopieren |
| `git status` | Was hat sich geändert? (**immer zuerst!**) |
| `git add datei` / `git add .` | Änderungen vormerken |
| `git commit -m "Nachricht"` | Vorgemerktes speichern |
| `git commit -am "…"` | add + commit (nur bekannte Dateien) |
| `git diff` / `git diff --staged` | Änderungen ansehen (nicht / schon vorgemerkt) |
| `git log --oneline --graph --all` | Verlauf als Graph |
| `git show HEAD` | letzten Commit im Detail |

`HEAD` = aktueller Commit, `HEAD~1` = der davor.

## Branches

| Befehl | Bedeutung |
|---|---|
| `git branch` | Branches auflisten (`*` = aktueller) |
| `git switch -c neu` | Branch anlegen + wechseln |
| `git switch name` / `git switch -` | wechseln / zum vorherigen |
| `git merge name` | `name` in den **aktuellen** Branch holen |
| `git branch -d name` | gemergten Branch löschen |

## Merge-Konflikt

```text
<<<<<<< HEAD
deine Version
=======
Version vom anderen Branch
>>>>>>> feature/x
```

1. Datei bearbeiten, **alle Marker entfernen**
2. `git add datei`
3. `git commit --no-edit`

Abbrechen: `git merge --abort`

## Remotes

| Befehl | Bedeutung |
|---|---|
| `git remote -v` | Remotes anzeigen (`origin`) |
| `git remote add origin URL` | Remote verbinden |
| `git push` / `git push -u origin branch` | hochladen / ersten Push eines Branches |
| `git fetch` | holen, Dateien **nicht** ändern |
| `git pull` | holen **und** mergen |

Push abgelehnt (*fetch first*)? → `git pull`, dann `git push`.
`git push --force` nie ohne Absprache!

## Rückgängig machen

| Situation | Befehl |
|---|---|
| Datei verpfuscht (nicht committet) | `git restore datei` ⚠️ weg |
| Datei aus Staging nehmen | `git restore --staged datei` |
| letzte Commit-Nachricht falsch | `git commit --amend -m "…"` |
| Commit zurücknehmen (schon gepusht) | `git revert ID` |
| Commits verwerfen, Änderungen behalten | `git reset --soft HEAD~1` |
| Commits **und** Änderungen verwerfen | `git reset --hard HEAD~1` ⚠️ |
| „Verlorenen“ Commit retten | `git reflog`, dann `git reset --hard HEAD@{1}` |

`--amend` und `reset` nur für Commits, die noch **nicht gepusht** sind.

## .gitignore

```text
*.log
node_modules/
geheim.txt
```

Schon committete Datei nachträglich ignorieren: `git rm --cached datei`.

## Editor (nano)

Speichern **Strg+O, Enter** · Beenden **Strg+X** · Zeile löschen **Strg+K**
