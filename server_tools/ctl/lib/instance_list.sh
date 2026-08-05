#!/bin/bash
# ==============================================================================
# instance_list.sh: Instance listing and status display
#
# Displays a formatted table of all local and Docker instances with their
# status, ports, environment type, and URLs.
# ==============================================================================

# ------------------------------------------------------------------------------
# List all instances
# ------------------------------------------------------------------------------
list_instances() {
    echo -e "${BLUE}📋 Easelect Instances${NC}"
    echo ""

    # ── Get current git branch (informational) ─────────────────────────────────
    local git_branch
    git_branch=$(git -C "$PROJECT_ROOT" branch --show-current 2>/dev/null || echo "unknown")

    # ── Collect local dev data ────────────────────────────────────────────────
    local local_app_port="8082"
    if [[ -f "$EASELECT_DEV_ENV_FILE" ]]; then
        local env_port=$(grep -E "^APP_PORT=" "$EASELECT_DEV_ENV_FILE" 2>/dev/null | cut -d'=' -f2)
        [[ -n "$env_port" ]] && local_app_port="$env_port"
    fi

    local local_db_port
    local_db_port=$(grep "^DB_PORT=" "$EASELECT_DEV_ENV_FILE" 2>/dev/null | cut -d'=' -f2 || true)
    if [[ -z "$local_db_port" ]]; then
        local_db_port=$(grep "^DB_PORT=" "$EASELECT_RUNTIME_ENV_FILE" 2>/dev/null | cut -d'=' -f2 || true)
    fi
    local_db_port="${local_db_port:-5432}"
    local local_status="stopped"
    local local_env="DEV"
    # Local dev instance is always the seed (golden master where dumps originate)
    local local_type="seed"

    if curl -k -s -o /dev/null "https://localhost:${local_app_port}/" --max-time 1 2>/dev/null; then
        local_status="running"
    fi

    # ── Check if Docker CLI is available ──────────────────────────────────────
    local docker_available=false
    if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
        docker_available=true
    fi

    # ── Collect Docker instance data into arrays ──────────────────────────────
    local -a inst_names=()
    local -a inst_domains=()
    local -a inst_ports=()
    local -a inst_db_ports=()
    local -a inst_statuses=()
    local -a inst_envs=()
    local -a inst_urls=()
    local -a inst_types=()

    if [[ -d "instances" ]]; then
        for dir in instances/*/; do
            if [[ -d "$dir" ]] && [[ "$(basename "$dir")" != "template" ]]; then
                local name=$(basename "$dir")
                local env_file="${dir}.env"
                local domain="-"
                local port="-"
                local status="not configured"
                local env_type="?"
                local url=""
                # Docker instances default to "derivative" (unique instance provisioned from seed dump)
                # Can be overridden with INSTANCE_TYPE in .env
                local inst_type="derivative"
                local db_port="-"

                if [[ -f "$env_file" ]]; then
                    eval "$(grep -E '^(DOMAIN|APP_PORT|DB_PORT|ENVIRONMENT_TYPE|INSTANCE_TYPE)=' "$env_file" 2>/dev/null)"
                    domain="${DOMAIN:-localhost}"
                    port="${APP_PORT:-8082}"
                    db_port="${DB_PORT:-5432}"
                    env_type="${ENVIRONMENT_TYPE:-dev}"
                    inst_type="${INSTANCE_TYPE:-derivative}"

                    # Normalize env label
                    case "$(ascii_lowercase "$env_type")" in
                        prod|production) env_type="PROD" ;;
                        *)               env_type="DEV"  ;;
                    esac

                    # Build URL (dev uses https://localhost:PORT)
                    if [[ "$env_type" == "PROD" ]]; then
                        url="https://${domain}"
                    else
                        url="https://localhost:${port}"
                    fi

                    # Check if instance is running:
                    # 1) Try docker ps if Docker CLI is available
                    # 2) Fallback: probe the port with curl
                    if [[ "$docker_available" == true ]]; then
                        if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "easelect-${name}-app"; then
                            status="running"
                        else
                            status="stopped"
                        fi
                    else
                        # Docker CLI not accessible — use port probe as fallback
                        if curl -k -s -o /dev/null "${url}/" --max-time 1 2>/dev/null; then
                            status="running"
                        else
                            status="stopped"
                        fi
                    fi

                    # Reset sourced vars
                    unset DOMAIN APP_PORT DB_PORT ENVIRONMENT_TYPE INSTANCE_TYPE
                fi

                inst_names+=("$name")
                inst_domains+=("$domain")
                inst_ports+=("$port")
                inst_db_ports+=("$db_port")
                inst_statuses+=("$status")
                inst_envs+=("$env_type")
                inst_urls+=("$url")
                inst_types+=("$inst_type")
            fi
        done
    fi

    # ── Calculate dynamic column widths ───────────────────────────────────────
    local col_inst=8  col_host=4  col_app=8  col_db=7  col_stat=6  col_env=3  col_type=6  col_url=3

    # Local row
    (( ${#local_app_port} + 0 > col_app )) && col_app=${#local_app_port}
    (( ${#local_db_port}  + 0 > col_db  )) && col_db=${#local_db_port}
    (( ${#local_type}     + 0 > col_type )) && col_type=${#local_type}

    # Docker rows — find max widths
    for i in "${!inst_names[@]}"; do
        local len_name=${#inst_names[$i]}
        local len_dom=${#inst_domains[$i]}
        local len_port=${#inst_ports[$i]}
        local len_dbport=${#inst_db_ports[$i]}
        local len_env=${#inst_envs[$i]}
        local len_url=${#inst_urls[$i]}
        local len_type=${#inst_types[$i]}
        (( len_name  > col_inst )) && col_inst=$len_name
        (( len_dom   > col_host )) && col_host=$len_dom
        (( len_port  > col_app  )) && col_app=$len_port
        (( len_dbport > col_db  )) && col_db=$len_dbport
        (( len_env   > col_env  )) && col_env=$len_env
        (( len_url   > col_url  )) && col_url=$len_url
        (( len_type  > col_type )) && col_type=$len_type
    done

    # "localhost" is 9 chars
    (( 9 > col_host )) && col_host=9
    # Minimum readability padding
    (( col_inst < 8 )) && col_inst=8
    (( col_app  < 8 )) && col_app=8
    (( col_db   < 7 )) && col_db=7
    (( col_stat < 7 )) && col_stat=7
    (( col_env  < 4 )) && col_env=4
    (( col_type < 6 )) && col_type=6
    (( col_url  < 3 )) && col_url=3

    # Add 2-char gutter between columns
    local g=2

    # ── Print local development section ───────────────────────────────────────
    echo "Local development:"
    local local_total=$(( col_inst + g + col_host + g + col_app + g + col_db + g + col_stat + g + col_env + g + col_type + g + col_url ))
    print_separator "$local_total"
    printf "%-$(( col_inst + g ))s %-$(( col_host + g ))s %-$(( col_app + g ))s %-$(( col_db + g ))s %-$(( col_stat + g ))s %-$(( col_env + g ))s %-$(( col_type + g ))s %s\n" \
        "INSTANCE" "HOST" "APP_PORT" "DB_PORT" "STATUS" "ENV" "TYPE" "URL"
    print_separator "$local_total"

    # Status with color
    local local_status_colored
    if [[ "$local_status" == "running" ]]; then
        local_status_colored="${GREEN}running${NC}"
    else
        local_status_colored="${YELLOW}stopped${NC}"
    fi

    local local_url="https://localhost:${local_app_port}"
    local local_url_link
    local_url_link=$(make_link "$local_url" "$local_url")

    printf "%-$(( col_inst + g ))s %-$(( col_host + g ))s %-$(( col_app + g ))s %-$(( col_db + g ))s " \
        "local" "localhost" "$local_app_port" "$local_db_port"
    # Status with color
    printf "%b" "$local_status_colored"
    printf '%*s' $(( col_stat + g - ${#local_status} )) ''
    printf "%-$(( col_env + g ))s " "$local_env"
    printf "%-$(( col_type + g ))s " "$local_type"
    echo -e "$local_url_link"

    echo ""

    # ── Print Docker instances section ────────────────────────────────────────
    if [[ ${#inst_names[@]} -eq 0 ]]; then
        echo "   No Docker instances found."
    else
        echo "Docker instances (local containers):"
        local docker_total=$(( col_inst + g + col_host + g + col_app + g + col_db + g + col_stat + g + col_env + g + col_type + g + col_url ))
        print_separator "$docker_total"
        printf "%-$(( col_inst + g ))s %-$(( col_host + g ))s %-$(( col_app + g ))s %-$(( col_db + g ))s %-$(( col_stat + g ))s %-$(( col_env + g ))s %-$(( col_type + g ))s %s\n" \
            "INSTANCE" "DOMAIN" "APP_PORT" "DB_PORT" "STATUS" "ENV" "TYPE" "URL"
        print_separator "$docker_total"

        for i in "${!inst_names[@]}"; do
            local st="${inst_statuses[$i]}"
            local st_colored
            if [[ "$st" == "running" ]]; then
                st_colored="${GREEN}running${NC}"
            else
                st_colored="${YELLOW}stopped${NC}"
            fi

            local env_colored
            if [[ "${inst_envs[$i]}" == "PROD" ]]; then
                env_colored="${RED}PROD${NC}"
            else
                env_colored="${BLUE}DEV${NC}"
            fi

            local url_link
            if [[ -n "${inst_urls[$i]}" ]]; then
                url_link=$(make_link "${inst_urls[$i]}" "${inst_urls[$i]}")
            else
                url_link="-"
            fi

            printf "%-$(( col_inst + g ))s %-$(( col_host + g ))s %-$(( col_app + g ))s %-$(( col_db + g ))s " \
                "${inst_names[$i]}" "${inst_domains[$i]}" "${inst_ports[$i]}" "${inst_db_ports[$i]}"
            # Status with color
            printf "%b" "$st_colored"
            printf '%*s' $(( col_stat + g - ${#st} )) ''
            # Env with color
            printf "%b" "$env_colored"
            printf '%*s' $(( col_env + g - ${#inst_envs[$i]} )) ''
            # Type (seed/branch)
            printf "%-$(( col_type + g ))s " "${inst_types[$i]}"
            echo -e "$url_link"
        done
    fi

    echo ""

    # Show running Docker containers
    if [[ "$docker_available" == true ]]; then
        echo "Running containers:"
        docker ps --filter "name=easelect" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "   (Docker not available)"
    else
        echo -e "${YELLOW}⚠  Docker CLI not accessible (user not in docker group). Status detected via port probe.${NC}"
    fi
}
