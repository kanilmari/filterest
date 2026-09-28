#!/usr/bin/env bash
# database_dump_options.sh
# Holds the pg_dump options of every Filterest update backup, native or Docker.
# Bridges update_filterest.sh and run_filterest_docker.sh, which dump the same
# database from two different places.
# Why privileges stay in: the grants the limited database roles need were made at
# first start and by the running application, and exist nowhere else. A restore
# can still leave them out (pg_restore --no-privileges); a dump without them can
# never put them back.

# shellcheck disable=SC2034 # Read by the scripts that source this file.
FILTEREST_DATABASE_DUMP_OPTIONS=(--format=custom --no-owner)
