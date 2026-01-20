#!/bin/sh

set -e

ALIAS_LINE="alias ploinky-start-explorer='.ploinky/repos/fileExplorer/scripts/start-explorer-enabled.sh'"
SHELL_RC="${HOME}/.zshrc"

if [ -n "${ZDOTDIR:-}" ]; then
  SHELL_RC="${ZDOTDIR}/.zshrc"
fi

if [ ! -f "$SHELL_RC" ]; then
  touch "$SHELL_RC"
fi

if ! grep -Fq "$ALIAS_LINE" "$SHELL_RC"; then
  printf "\n%s\n" "$ALIAS_LINE" >> "$SHELL_RC"
  echo "Added alias to $SHELL_RC"
else
  echo "Alias already present in $SHELL_RC"
fi

echo "Run: source \"$SHELL_RC\""
