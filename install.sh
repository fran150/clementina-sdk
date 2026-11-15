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
# Arguments go to `clementina install`: ... | sh -s -- emulator --no-modify-path
# CLEMENTINA_VERSION=v0.3.0-alpha.1 picks a release; CLEMENTINA_HOME moves the folder.
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
if [ -z "$tag" ]; then
  # The newest SDK release, alphas included. Other tags (cc65-v*) are not SDK releases.
  tag="$(curl -fsSL "https://api.github.com/repos/$repo/releases?per_page=30" \
    | sed -n 's/.*"tag_name": *"\(v[^"]*\)".*/\1/p' | head -n 1)"
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
