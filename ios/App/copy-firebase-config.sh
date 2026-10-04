#!/bin/sh
set -eu

SOURCE="${SRCROOT}/App/GoogleService-Info.plist"
DESTINATION="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/GoogleService-Info.plist"

if [ -f "$SOURCE" ]; then
  cp "$SOURCE" "$DESTINATION"
elif [ "${DIVIDIMOS_REQUIRE_FIREBASE:-NO}" = "YES" ]; then
  echo "error: ios/App/App/GoogleService-Info.plist is missing; a release build cannot ship without Firebase config." >&2
  exit 1
else
  rm -f "$DESTINATION"
fi
