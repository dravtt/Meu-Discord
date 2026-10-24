# Database dump with integrity checks (sourced by backup-loop.sh inside the container and by lib.sh on the host).
# verify_dump FILE: gzip is intact and pg_dump wrote its end marker (an interrupted dump has no marker).
verify_dump() {
  gzip -t "$1" 2>/dev/null && [ "$(gzip -dc "$1" | tail -n 5 | grep -c 'PostgreSQL database dump complete')" = 1 ]
}
# dump_db FILE [pg_dump connection args...]: writes FILE only when the whole dump succeeded and verifies.
dump_db() {
  local f="$1"; shift
  local tmp="$f.parcial"
  rm -f "$tmp"
  if pg_dump "$@" -U voka voka | gzip > "$tmp" && verify_dump "$tmp"; then mv "$tmp" "$f"; return 0; fi
  rm -f "$tmp"; return 1
}
