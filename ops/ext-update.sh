#!/usr/bin/env bash
# Keeps unpacked Chrome/Edge extensions current (pairs with @mn/blocks/ext-update).
#
#   ext-update.sh run [config]        copy any extension whose manifest version changed
#   ext-update.sh install [config]    copy this script to ~/.mn-extensions/.bin and schedule
#                                     `run` every 30 min (launchd on macOS, Task Scheduler on Windows/Git Bash)
#   ext-update.sh uninstall           remove the schedule
#   ext-update.sh list [config]       show each extension's installed version
#
# Config (default ~/.config/mn-ext-update/extensions), one extension per line:
#   <name> <git url> <branch> <folder in repo, or .> [build command]
#   e.g.  workspace-switcher https://github.com/me/edge-workspace-switcher.git main .
#         autodealer-sms     https://github.com/me/AutoDealer.git master chrome-extension
#         ews https://github.com/me/edge-workspace-switcher.git master dist corepack pnpm install --frozen-lockfile && corepack pnpm build
#
# With a build command (the rest of the line, run by sh in the repo), the whole repo is
# cloned, the version is read from the repo's root manifest.json, and only when it changed
# is the command run and <folder> (the build output) copied in. A failed build keeps the
# copy in use. Build tools must be on PATH (launchd gets /opt/homebrew/bin:/usr/local/bin).
#
# Each extension lands in ~/.mn-extensions/<name> (MN_EXT_ROOT overrides). Load that folder
# once with "Load unpacked"; keep "key" in its manifest so the ID never changes. A new
# version is "released" by bumping manifest.json "version" on the branch. Git uses your
# normal credentials, so private repos work without a token.
set -euo pipefail

CMD=${1:-run}
CONF=${2:-${MN_EXT_CONF:-$HOME/.config/mn-ext-update/extensions}}
ROOT=${MN_EXT_ROOT:-$HOME/.mn-extensions}
LABEL=com.mn.ext-update

version_of() { [ -f "$1" ] && sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -1 || true; }

sync_one() {
  local name=$1 url=$2 branch=$3 sub=$4 build=${5:-}
  case "$name" in *[!A-Za-z0-9._-]*|'') echo "$name: bad name (letters, digits, . _ - only)" >&2; return 1 ;; esac
  local src="$ROOT/.src/$name"
  if [ ! -d "$src/.git" ]; then
    rm -rf "$src"; mkdir -p "$ROOT/.src"
    if [ "$sub" = "." ] || [ -n "$build" ]; then
      git clone --quiet --depth 1 --branch "$branch" "$url" "$src"
    else
      git clone --quiet --depth 1 --filter=blob:none --sparse --branch "$branch" "$url" "$src"
      git -C "$src" sparse-checkout set "$sub"
    fi
  else
    git -C "$src" fetch --quiet --depth 1 origin "$branch"
    git -C "$src" reset --quiet --hard FETCH_HEAD
  fi
  local new="$src/$sub" dest="$ROOT/$name" vfile="$src/$sub/manifest.json"
  [ -n "$build" ] && vfile="$src/manifest.json"
  [ -f "$vfile" ] || { echo "$name: no manifest.json in ${build:+the repo root}${build:-$sub}" >&2; return 1; }
  local nv ov
  nv=$(version_of "$vfile"); ov=$(version_of "$dest/manifest.json")
  [ -n "$nv" ] || { echo "$name: no version in manifest.json" >&2; return 1; }
  if [ -n "$ov" ] && [ "$nv" = "$ov" ]; then echo "$name: $ov (current)"; return 0; fi
  if [ -n "$build" ]; then
    echo "$name: building $nv"
    (cd "$src" && sh -c "$build") || { echo "$name: build failed; kept ${ov:-nothing}" >&2; return 1; }
    [ "$(version_of "$new/manifest.json")" = "$nv" ] || { echo "$name: build left no $sub/manifest.json at $nv; kept ${ov:-nothing}" >&2; return 1; }
  fi
  # Every step checks itself: set -e is off inside a function called from `... || rc=1`.
  rm -rf "$dest.new" "$dest.old" || return 1
  mkdir -p "$dest.new" || return 1
  (cd "$new" && tar --exclude .git -cf - .) | (cd "$dest.new" && tar -xf -) || { echo "$name: copy failed; kept $ov" >&2; rm -rf "$dest.new"; return 1; }
  [ -f "$dest.new/manifest.json" ] || { echo "$name: copy incomplete; kept $ov" >&2; rm -rf "$dest.new"; return 1; }
  if [ -d "$dest" ]; then
    mv "$dest" "$dest.old" || { echo "$name: could not move the old copy aside (a file in use?); kept $ov" >&2; rm -rf "$dest.new"; return 1; }
  fi
  mv "$dest.new" "$dest" || { echo "$name: could not move the new copy in; restoring $ov" >&2; [ -d "$dest.old" ] && mv "$dest.old" "$dest"; return 1; }
  rm -rf "$dest.old"
  echo "$name: ${ov:-none} -> $nv"
}

each() {
  [ -f "$CONF" ] || { echo "No config at $CONF (see the header of this script)" >&2; exit 1; }
  local rc=0 line name url branch sub build
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line//$'\r'/}   # config saved with Windows line endings
    read -r name url branch sub build <<< "$line" || true
    case "$name" in ''|'#'*) continue ;; esac
    "$@" "$name" "$url" "${branch:-main}" "${sub:-.}" "$build" || rc=1
  done < "$CONF"
  return $rc
}

list_one() { echo "$1: $(version_of "$ROOT/$1/manifest.json")"; }

xml() { local s=${1//&/&amp;}; s=${s//</&lt;}; printf '%s' "${s//>/&gt;}"; }

install() {
  mkdir -p "$ROOT/.bin"
  cp "$0" "$ROOT/.bin/ext-update.sh"; chmod +x "$ROOT/.bin/ext-update.sh"
  local script="$ROOT/.bin/ext-update.sh"
  case "$(uname -s)" in
    Darwin)
      local plist="$HOME/Library/LaunchAgents/$LABEL.plist"
      mkdir -p "$HOME/Library/LaunchAgents"
      cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$(xml "$script")</string><string>run</string><string>$(xml "$CONF")</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string><key>MN_EXT_ROOT</key><string>$(xml "$ROOT")</string><key>COREPACK_ENABLE_DOWNLOAD_PROMPT</key><string>0</string></dict>
  <key>StartInterval</key><integer>1800</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$(xml "$ROOT")/.bin/ext-update.log</string>
  <key>StandardErrorPath</key><string>$(xml "$ROOT")/.bin/ext-update.log</string>
</dict></plist>
PLIST
      launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
      launchctl bootstrap "gui/$(id -u)" "$plist"
      echo "Scheduled every 30 min with launchd ($plist)." ;;
    MINGW*|MSYS*|CYGWIN*)
      local bash_w script_w conf_w
      bash_w=$(cygpath -w "$(command -v bash)"); script_w=$(cygpath -w "$script"); conf_w=$(cygpath -w "$CONF")
      # conhost --headless keeps a console window from flashing up every run; -l gives a login
      # shell so Git's /usr/bin (sed, tar, mkdir) is on PATH.
      schtasks //Create //F //SC MINUTE //MO 30 //TN "mn-ext-update" \
        //TR "conhost.exe --headless \"$bash_w\" -l \"$script_w\" run \"$conf_w\"" >/dev/null
      echo "Scheduled every 30 min in Task Scheduler (mn-ext-update)." ;;
    *) echo "Unsupported OS: schedule '$script run' yourself." >&2; exit 1 ;;
  esac
  "$script" run "$CONF" || true
}

uninstall() {
  case "$(uname -s)" in
    Darwin) launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true; rm -f "$HOME/Library/LaunchAgents/$LABEL.plist" ;;
    MINGW*|MSYS*|CYGWIN*) schtasks //Delete //F //TN "mn-ext-update" >/dev/null 2>&1 || true ;;
  esac
  echo "Schedule removed. Extension folders in $ROOT are left as they are."
}

case "$CMD" in
  run) each sync_one ;;
  list) each list_one ;;
  install) install ;;
  uninstall) uninstall ;;
  *) echo "usage: ext-update.sh run|install|uninstall|list [config]" >&2; exit 2 ;;
esac
