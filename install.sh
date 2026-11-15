#!/bin/sh
# Installs the Clementina SDK and its toolchain on macOS and Linux:
#
#   curl -fsSL https://raw.githubusercontent.com/fran150/clementina-sdk/main/install.sh | sh
#
# It downloads the `clementina` command-line tool from the newest SDK release
# into ~/.clementina/bin, checks it against the release's SHA256SUMS, then runs
# `clementina install`, which installs cc65, the emulator, the video client and
# Studio and puts ~/.clementina/bin on PATH. Run it again to update.
#
# --version picks an SDK release instead of the newest: ... | sh -s -- --version 0.3.0-alpha.2
# Other arguments go to `clementina install`, which takes tool@version too:
#   ... | sh -s -- emulator@0.4.0-alpha.1 video-client --no-modify-path
# CLEMENTINA_VERSION also picks the release; CLEMENTINA_HOME moves the folder.
# Windows uses install.ps1. See docs/install.md.
set -eu

repo=fran150/clementina-sdk
home="${CLEMENTINA_HOME:-$HOME/.clementina}"

fail() { echo "clementina install: $*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "this script is for macOS and Linux; on Windows run install.ps1 in PowerShell" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "no Clementina release is built for $(uname -m)" ;;
esac
# A Terminal running under Rosetta reports x86_64 on Apple silicon.
if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
  arch=arm64
fi

command -v curl >/dev/null 2>&1 || fail "curl is required"
tag="${CLEMENTINA_VERSION:-}"
# Take --version out of the arguments; the rest go to `clementina install`.
count=$#
while [ "$count" -gt 0 ]; do
  arg="$1"; shift; count=$((count - 1))
  case "$arg" in
    --version)
      [ "$count" -gt 0 ] || fail "--version needs a release, such as 0.3.0-alpha.2"
      tag="$1"; shift; count=$((count - 1)) ;;
    --version=*) tag="${arg#--version=}" ;;
    *) set -- "$@" "$arg" ;;
  esac
done
if [ -n "$tag" ]; then
  case "$tag" in v*) ;; *) tag="v$tag" ;; esac
else
  # The newest SDK release, alphas included. Other tags (cc65-v*) are not SDK releases.
  tag="$(curl -fsSL "https://api.github.com/repos/$repo/releases?per_page=30" 2>/dev/null \
    | sed -n 's/.*"tag_name": *"\(v[0-9][^"]*\)".*/\1/p' | head -n 1)" || true
  # Without a token the API allows 60 requests an hour; the releases feed has no limit.
  [ -n "$tag" ] || tag="$(curl -fsSL "https://github.com/$repo/releases.atom" \
    | grep -o '/releases/tag/v[0-9][^"<]*' | head -n 1 | sed 's|.*/||')" || true
  [ -n "$tag" ] || fail "could not find an SDK release on GitHub"
fi

asset="clementina-$os-$arch"
base="https://github.com/$repo/releases/download/$tag"
mkdir -p "$home/bin"
partial="$home/bin/.clementina.download"
trap 'rm -f "$partial"' EXIT

echo "Downloading clementina $tag ($asset)"
curl -fSL --progress-bar "$base/$asset" -o "$partial"
expected="$(curl -fsSL "$base/SHA256SUMS" | awk -v name="$asset" '$2 == name || $2 == "*" name { print $1 }')"
[ -n "$expected" ] || fail "SHA256SUMS of $tag lists no $asset"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$partial" | awk '{ print $1 }')"
else
  actual="$(shasum -a 256 "$partial" | awk '{ print $1 }')"
fi
[ "$actual" = "$expected" ] || fail "$asset does not match its SHA256SUMS entry"
chmod 755 "$partial"
mv -f "$partial" "$home/bin/clementina"

CLEMENTINA_HOME="$home" "$home/bin/clementina" install "$@"
