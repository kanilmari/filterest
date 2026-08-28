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
SOURCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
INSTALLATION_ROOT="${FILTEREST_ROOT:-${FILTEREST_PROJECT_ROOT_OVERRIDE:-$SOURCE_ROOT}}"
INSTALLATION_ROOT="$(cd "$INSTALLATION_ROOT" && pwd -P)"
PROJECT_ROOT="$INSTALLATION_ROOT"
source "$SCRIPT_DIR/ctl/lib/env_permissions.sh"
source "$SCRIPT_DIR/lib/easelect_private_paths.sh"
easelect_resolve_private_paths "$PROJECT_ROOT"
if [[ "$SOURCE_ROOT" == "$INSTALLATION_ROOT/app" ]]; then
  protected_runtime_root="$FILTEREST_KEYS_HOME/filterest_runtime"
  EASELECT_RUNTIME_ENV_FILE="$protected_runtime_root/runtime_environment.env"
  EASELECT_DEV_ENV_FILE="$protected_runtime_root/development_environment.env"
  EASELECT_TLS_CERT_FILE="$protected_runtime_root/local_tls_certificate/localhost_certificate.crt"
  EASELECT_TLS_KEY_FILE="$protected_runtime_root/local_tls_certificate/localhost_private_key.key"
  export EASELECT_RUNTIME_ENV_FILE EASELECT_DEV_ENV_FILE
  export EASELECT_TLS_CERT_FILE EASELECT_TLS_KEY_FILE
fi
cd "$PROJECT_ROOT"

# ---------------------------------------------------------------------------
# Ympäristötiedostot ja niiden versionhallittavat scaffold-kohteet
# ---------------------------------------------------------------------------
SCAFFOLD_EXTENSION_ROOT="${FILTEREST_SCAFFOLD_EXTENSION_ROOT:-}"
SCAFFOLD_EXTENSION_ENV_SOURCES="${FILTEREST_SCAFFOLD_EXTENSION_ENV_SOURCES:-}"
SCAFFOLD_EXTENSION_ENV_TEMPLATES="${FILTEREST_SCAFFOLD_EXTENSION_ENV_TEMPLATES:-}"
MACHINE_TRANSFER_COMMAND="${FILTEREST_MACHINE_TRANSFER_COMMAND:-}"
HAS_SCAFFOLD_EXTENSION=0
if [[ -n "$SCAFFOLD_EXTENSION_ROOT" ]]; then
  if [[ ! -d "$SCAFFOLD_EXTENSION_ROOT" ]]; then
    err "Scaffold-laajennushakemistoa ei löydy: $SCAFFOLD_EXTENSION_ROOT"
    exit 1
  fi
  HAS_SCAFFOLD_EXTENSION=1
  ENV_SOURCE_FILES=(
    "$EASELECT_RUNTIME_ENV_FILE"
    "$EASELECT_DEV_ENV_FILE"
  )
  ENV_SCAFFOLD_FILES=(
    "$PROJECT_ROOT/.env.scaffold"
    "$PROJECT_ROOT/dev_env.scaffold"
  )
  while IFS= read -r relative_path || [[ -n "$relative_path" ]]; do
    [[ -n "$relative_path" ]] && ENV_SOURCE_FILES+=("$PROJECT_ROOT/$relative_path")
  done <<< "$SCAFFOLD_EXTENSION_ENV_SOURCES"
  while IFS= read -r relative_path || [[ -n "$relative_path" ]]; do
    [[ -n "$relative_path" ]] && ENV_SCAFFOLD_FILES+=("$SCAFFOLD_EXTENSION_ROOT/$relative_path")
  done <<< "$SCAFFOLD_EXTENSION_ENV_TEMPLATES"
  if [[ "${#ENV_SOURCE_FILES[@]}" -ne "${#ENV_SCAFFOLD_FILES[@]}" ]]; then
    err "Scaffold-laajennuksen lähde- ja mallipolkujen määrät eivät täsmää"
    exit 1
  fi
else
  ENV_SOURCE_FILES=(
    "$EASELECT_RUNTIME_ENV_FILE"
    "$EASELECT_DEV_ENV_FILE"
  )
  ENV_SCAFFOLD_FILES=(
    "$SOURCE_ROOT/.env.example"
    "$SOURCE_ROOT/.env.example"
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

  local dirs=()
  if [[ "$SOURCE_ROOT" == "$INSTALLATION_ROOT/app" ]]; then
    dirs=(
      "$INSTALLATION_ROOT/config"
      "$INSTALLATION_ROOT/keys"
      "$INSTALLATION_ROOT/projects"
      "$INSTALLATION_ROOT/data/bootstrap"
      "$INSTALLATION_ROOT/data/storage"
      "$INSTALLATION_ROOT/data/storage_deleted"
      "$INSTALLATION_ROOT/data/others"
      "$INSTALLATION_ROOT/data/runtime/bin"
      "$INSTALLATION_ROOT/data/runtime/logs"
      "$INSTALLATION_ROOT/data/testing/test-results"
      "$INSTALLATION_ROOT/data/testing/test-results-visual"
      "$INSTALLATION_ROOT/data/testing/my-test-results"
      "$INSTALLATION_ROOT/data/testing/playwright-report"
      "$INSTALLATION_ROOT/data/testing/e2e/.auth"
      "$INSTALLATION_ROOT/backups"
    )
  else
    dirs=(
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
      "docker/traefik/logs"
      "testing/e2e/.auth"
    )
  fi

  # Optional source compositions may declare their own local workflow state.
  # A standalone Filterest checkout has no extension root and creates none.
  if [[ "$HAS_SCAFFOLD_EXTENSION" -eq 1 ]]; then
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

  # Persist the nested public installation layout once so every later command
  # resolves protected keys and runtime data without source-tree links.
  if [[ "$SOURCE_ROOT" == "$INSTALLATION_ROOT/app" ]]; then
    chmod 700 \
      "$INSTALLATION_ROOT/config" \
      "$INSTALLATION_ROOT/keys" \
      "$INSTALLATION_ROOT/projects" \
      "$INSTALLATION_ROOT/data" \
      "$INSTALLATION_ROOT/data/bootstrap" \
      "$INSTALLATION_ROOT/backups"
    local path_contract="$INSTALLATION_ROOT/config/filterest.paths"
    if [[ -f "$path_contract" ]]; then
      skip "Polkusopimus jo olemassa: $path_contract"
    else
      (umask 077 && printf '%s\n' \
        'schema_version=1' \
        'projects_home=projects' \
        'keys_home=keys' \
        'runtime_data_home=data/runtime' \
        'maintainer_tools_home=data/maintainer_tools' \
        'operations_home=data/operations' \
        > "$path_contract")
      ok "Luotu polkusopimus: $path_contract"
    fi
  fi

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
    if [[ "$HAS_SCAFFOLD_EXTENSION" -eq 0 ]]; then
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
  if [[ -n "$MACHINE_TRANSFER_COMMAND" ]]; then
    echo "Käytä käyttöympäristön koneen siirtoon: $MACHINE_TRANSFER_COMMAND"
  else
    echo "Konesiirto ei kuulu julkiseen Filterest-lähteeseen; käytä oman käyttöympäristösi varmistettua siirtomenettelyä."
  fi
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

EOF

  if [[ -n "$MACHINE_TRANSFER_COMMAND" ]]; then
    echo -e "${CYAN}Käyttöympäristön koneen siirto dumppeineen ja sertifikaatteineen:${RESET}"
    echo -e "  ${GREEN}${MACHINE_TRANSFER_COMMAND}${RESET}"
    echo ""
  fi
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
