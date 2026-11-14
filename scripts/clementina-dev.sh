# clementina-dev: switch this shell between the installed Clementina tools and
# local dev builds. Source it from a bash or zsh startup file:
#
#   . ~/.clementina/dev/clementina-dev.sh
#
# `npm run dev:install` in the SDK copies this file there. Dev builds go into
# ~/.clementina/dev/bin (or $CLEMENTINA_DEV_BIN): `npm run dev:install` in the
# SDK, `make dev-install` in clementina-6502 and clementina-video-client.
#
#   clementina-dev on      put the dev folder first on PATH in this shell
#   clementina-dev off     remove it again, back to the installed tools
#   clementina-dev status  show which copy of each tool this shell runs

_clementina_dev_bin() {
  printf '%s\n' "${CLEMENTINA_DEV_BIN:-$HOME/.clementina/dev/bin}"
}

# Print PATH without the dev folder.
_clementina_dev_strip() {
  printf '%s' "$PATH" | awk -v RS=: -v dir="$1" '$0 != dir && $0 != "" { printf "%s%s", sep, $0; sep = ":" }'
}

clementina-dev() {
  _cd_bin=$(_clementina_dev_bin)
  case "${1:-status}" in
    on)
      PATH="$_cd_bin:$(_clementina_dev_strip "$_cd_bin")"
      export PATH
      hash -r 2>/dev/null
      echo "Clementina dev builds first on PATH: $_cd_bin"
      ;;
    off)
      PATH=$(_clementina_dev_strip "$_cd_bin")
      export PATH
      hash -r 2>/dev/null
      echo "Clementina dev builds off; using the installed tools."
      ;;
    status)
      for _cd_tool in clementina clementina-mcp clementina-emulator clementina-automation clementina-video-client clementina-render; do
        _cd_path=$(command -v "$_cd_tool" 2>/dev/null)
        case "$_cd_path" in
          "") echo "$_cd_tool: not found" ;;
          "$_cd_bin"/*) echo "$_cd_tool: dev, $_cd_path" ;;
          *) echo "$_cd_tool: installed, $_cd_path" ;;
        esac
      done
      ;;
    *)
      echo "usage: clementina-dev on|off|status" >&2
      unset _cd_bin
      return 2
      ;;
  esac
  unset _cd_bin _cd_tool _cd_path
}
