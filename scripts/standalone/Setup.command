#!/bin/sh
# Finder launcher; commands and advanced options are available in Setup.sh.
cd -P "$(dirname "$0")" || exit 1
sh ./Setup.sh "$@"
result=$?
printf '\nPress Return to close. '
read -r answer
exit "$result"
