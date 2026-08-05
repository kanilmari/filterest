#!/usr/bin/env bash
# scaffold.sh
# Creates env scaffold templates and prepares runtime directories for a clone.
# Bridges repository env templates, instance folders, and local setup placeholders.
# Exists to keep scaffold-only setup separate from DB bootstrap and machine handover.

set -euo pipefail

# ---------------------------------------------------------------------------
# Väritulosteet
# ---------------------------------------------------------------------------
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

ok()   { echo -e "${GREEN}✓${RESET} $*"; }
skip() { echo -e "${YELLOW}–${RESET} $*"; }
err()  { echo -e "${RED}✗${RESET} $*" >&2; }
info() { echo -e "${CYAN}→${RESET} $*"; }

# ---------------------------------------------------------------------------
# Navigoi projektin juureen (SCRIPT_DIR:n avulla)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$PROJECT_ROOT/server_tools/ctl/lib/env_permissions.sh"
source "$PROJECT_ROOT/server_tools/lib/easelect_private_paths.sh"
easelect_resolve_private_paths "$PROJECT_ROOT"
cd "$PROJECT_ROOT"

# ---------------------------------------------------------------------------
# Ympäristötiedostot ja niiden versionhallittavat scaffold-kohteet
# ---------------------------------------------------------------------------
IS_GENERATED_FILTEREST_CHECKOUT=0
if [[ -f "$PROJECT_ROOT/VERSION_APP" && ! -f "$PROJECT_ROOT/VERSION_EASELECT" ]]; then
  IS_GENERATED_FILTEREST_CHECKOUT=1
  ENV_SOURCE_FILES=(
    "$EASELECT_RUNTIME_ENV_FILE"
    "$EASELECT_DEV_ENV_FILE"
  )
  ENV_SCAFFOLD_FILES=(
    "$PROJECT_ROOT/server_tools/scaffolds/runtime.env.scaffold"
    "$PROJECT_ROOT/server_tools/scaffolds/development.env.scaffold"
  )
else
  ENV_SOURCE_FILES=(
    "$EASELECT_RUNTIME_ENV_FILE"
    "$EASELECT_DEV_ENV_FILE"
    "$PROJECT_ROOT/instances/serlog.com/.env"
  )
  ENV_SCAFFOLD_FILES=(
    "$PROJECT_ROOT/.env.scaffold"
    "$PROJECT_ROOT/dev_env.scaffold"
    "$PROJECT_ROOT/instances/serlog.com/.env.scaffold"
  )
fi

# ---------------------------------------------------------------------------
# Apufunktio: Luo .env.scaffold yhdestä .env-tiedostosta
# Säilyttää kommentit, tyhjentää arvot. Tukee monirivisiä single-quoted arvoja.
# ---------------------------------------------------------------------------
generate_scaffold_for_file() {
  local src="$1"
  local dst="$2"
  # Varmista, että lähdetiedosto on olemassa
  if [[ ! -f "$src" ]]; then
    skip "$src ei löydy — ohitetaan"
    return
  fi

  local in_multiline=0

  # Käsittele tiedosto rivi riviltä
  {
    while IFS= read -r line || [[ -n "$line" ]]; do
      # Olemme monirivisen single-quoted arvon sisällä
      if [[ $in_multiline -eq 1 ]]; then
        # Etsi sulkeva heittomerkki
        if [[ "$line" == *"'" ]]; then
          in_multiline=0
        fi
        # Älä tulosta sisältöä — arvo on jo tyhjennetty
        continue
      fi

      # Kommentti tai tyhjä rivi — tulosta sellaisenaan
      if [[ "$line" =~ ^[[:space:]]*# ]] || [[ -z "${line// /}" ]]; then
        echo "$line"
        continue
      fi

      # Monirivi single-quoted arvo: KEY='...(ei sulkevaa heittomerkkiä tällä rivillä)
      if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=\'[^\']*$ ]]; then
        local key="${BASH_REMATCH[1]}"
        echo "${key}="
        in_multiline=1
        continue
      fi

      # Normaali KEY=value tai KEY='value' tai KEY="value" — tyhjennä arvo
      if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)= ]]; then
        local key="${BASH_REMATCH[1]}"
        echo "${key}="
        continue
      fi

      # Muu rivi (esim. jatkuminen) — tulostetaan sellaisenaan
      echo "$line"
    done
  } < "$src" > "$dst"

  ok "Generoitu: $dst"
}

# ---------------------------------------------------------------------------
# GENERATE: Luo .env.scaffold-tiedostot toimivalla koneella
# ---------------------------------------------------------------------------
cmd_generate() {
  echo ""
  info "Generoidaan .env.scaffold-tiedostot..."
  echo ""
  local index
  for index in "${!ENV_SOURCE_FILES[@]}"; do
    generate_scaffold_for_file \
      "${ENV_SOURCE_FILES[$index]}" \
      "${ENV_SCAFFOLD_FILES[$index]}"
  done
  echo ""
  ok "Valmis. Lisää .env.scaffold-tiedostot versionhallintaan (jos ei vielä lisätty)."
  echo ""
}

# ---------------------------------------------------------------------------
# SETUP: Alustaa uuden kloonin
# ---------------------------------------------------------------------------
cmd_setup() {
  echo ""
  info "Alustetaan projekti uudelle koneelle..."
  echo ""

  # --- 1. Luo tarvittavat hakemistot ---
  info "Luodaan hakemistot..."

  easelect_prepare_local_path_boundaries "$PROJECT_ROOT"
  if [[ -e "$FILTEREST_PROJECTS_HOME" && ! -d "$FILTEREST_PROJECTS_HOME" ]]; then
    err "Projektijuuri on olemassa mutta ei ole hakemisto: $FILTEREST_PROJECTS_HOME"
    return 1
  elif [[ -d "$FILTEREST_PROJECTS_HOME" ]]; then
    skip "Projektijuuri jo olemassa: $FILTEREST_PROJECTS_HOME"
  else
    mkdir -p "$FILTEREST_PROJECTS_HOME"
    chmod 700 "$FILTEREST_PROJECTS_HOME"
    ok "Luotu projektijuuri: $FILTEREST_PROJECTS_HOME"
  fi

  local dirs=(
    "storage"
    "storage_deleted"
    "data/others"
    "data/db_backups"
    "testing/test-results"
    "testing/test-results-visual"
    "testing/my-test-results"
    "testing/playwright-report"
    "runtime/bin"
    "runtime/logs"
    "server_tools/delivery_chain/helpers/patch_history"
    "docker/traefik/logs"
    "testing/e2e/.auth"
  )

  # Queen is a private Easelect development workflow. Generated Filterest
  # checkouts do not ship that tooling, so they should not create its runtime
  # directory during ordinary product setup.
  if [[ "$IS_GENERATED_FILTEREST_CHECKOUT" -eq 0 ]]; then
    dirs+=(".queen")
  fi

  for dir in "${dirs[@]}"; do
    if [[ -d "$dir" ]]; then
      skip "Hakemisto jo olemassa: $dir"
    else
      mkdir -p "$dir"
      ok "Luotu: $dir"
    fi
  done

  # Instance-kohtaiset backup-hakemistot
  for inst in instances/*/; do
    if [[ -d "$inst" ]]; then
      local backup_dir="${inst}backups"
      if [[ -d "$backup_dir" ]]; then
        skip "Hakemisto jo olemassa: $backup_dir"
      else
        mkdir -p "$backup_dir"
        ok "Luotu: $backup_dir"
      fi
    fi
  done

  echo ""

  # --- 2. Kopioi scaffoldit oikeisiin runtime-kohteisiin jos ne puuttuvat ---
  info "Tarkistetaan ympäristötiedostot..."

  local env_created=0
  local env_skipped=0
  local env_missing=0

  local index
  for index in "${!ENV_SOURCE_FILES[@]}"; do
    local env_file="${ENV_SOURCE_FILES[$index]}"
    local scaffold="${ENV_SCAFFOLD_FILES[$index]}"

    if [[ ! -f "$scaffold" ]]; then
      skip "Scaffold puuttuu: $scaffold (ohitetaan)"
      (( env_missing++ )) || true
      continue
    fi

    if [[ -f "$env_file" ]]; then
      skip "Ympäristötiedosto jo olemassa — ei ylikirjoiteta: $env_file"
      warn_secret_env_file_permissions "$env_file" "scaffold setup"
      (( env_skipped++ )) || true
    else
      mkdir -p "$(dirname "$env_file")"
      if [[ "$env_file" == "$EASELECT_RUNTIME_ENV_FILE" || "$env_file" == "$EASELECT_DEV_ENV_FILE" ]]; then
        chmod 700 "$(dirname "$env_file")"
      fi
      cp "$scaffold" "$env_file"
      set_secret_env_file_permissions "$env_file"
      ok "Kopioitu scaffold → $env_file"
      (( env_created++ )) || true
    fi
  done

  # --- 3. Yhteenveto ---
  echo ""
  echo -e "${CYAN}========================================${RESET}"
  echo -e "${CYAN} Yhteenveto${RESET}"
  echo -e "${CYAN}========================================${RESET}"
  echo "  Ympäristötiedostot luotu:    $env_created"
  echo "  Ympäristötiedostot ohitettu: $env_skipped"
  echo "  Scaffold puuttui:          $env_missing"
  echo ""
  if [[ $env_created -gt 0 ]]; then
    if [[ -f "$PROJECT_ROOT/VERSION_APP" && ! -f "$PROJECT_ROOT/VERSION_EASELECT" ]]; then
      echo -e "${GREEN}Pakolliset Filterest-asetukset täytetään ja tarkistetaan automaattisesti seuraavassa vaiheessa.${RESET}"
      echo "Valinnaiset integraatiot voi määrittää myöhemmin."
    else
      echo -e "${YELLOW}Muista täyttää arvot ympäristötiedostoihin ennen palvelimen käynnistystä!${RESET}"
    fi
    echo ""
  fi
  ok "Alustus valmis."
  echo ""
}

# ---------------------------------------------------------------------------
# EXPORT: Retired compatibility command.
# ---------------------------------------------------------------------------
cmd_export() {
  err "scaffold.sh export on poistettu käytöstä rinnakkaisena käsinsiirtopolkuna."
  echo "Käytä koneen siirtoon: ./server_tools/migrate_to_new_machine.sh --export"
  echo "Fresh clone -alustukseen käytä: ./server_tools/scaffold.sh setup"
  return 2
}

# ---------------------------------------------------------------------------
# --help
# ---------------------------------------------------------------------------
cmd_help() {
  cat <<EOF

${CYAN}scaffold.sh${RESET} — Projektin käyttöönottoapuri

${CYAN}Käyttö:${RESET}
  ./server_tools/scaffold.sh generate   Luo .env.scaffold-tiedostot (toimivalla koneella)
  ./server_tools/scaffold.sh setup      Alustaa kloonin uudella koneella
  ./server_tools/scaffold.sh --help     Näytä tämä ohje

${CYAN}Työnkulku:${RESET}
  1. Toimivalla koneella: ${GREEN}./server_tools/scaffold.sh generate${RESET}
     → Luo .env.scaffold-tiedostot joissa avaimet mutta ei arvoja
     → Lisää ne versionhallintaan

  2. Uudella koneella kloonin jälkeen: ${GREEN}./server_tools/scaffold.sh setup${RESET}
     → Luo tarvittavat hakemistot
     → Luo dynaamisen projects_home-juuren ja suojaa checkoutin sisäiset juuret
     → Kopioi scaffoldit ratkaistuun keys_home-profiiliin tai legacy-runtimepolkuun
     → Täytä sitten arvot ympäristötiedostoihin käsin

  Koneen siirto dumppeineen ja sertifikaatteineen: ${GREEN}./server_tools/migrate_to_new_machine.sh --export${RESET}

EOF
}

# ---------------------------------------------------------------------------
# Pääohjelma
# ---------------------------------------------------------------------------
case "${1:-}" in
  generate) cmd_generate ;;
  setup)    cmd_setup ;;
  export)   cmd_export ;;
  --help|-h|help) cmd_help ;;
  *)
    err "Tuntematon komento: '${1:-}'"
    cmd_help
    exit 1
    ;;
esac
