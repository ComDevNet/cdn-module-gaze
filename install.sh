#!/bin/bash
set -euo pipefail

sudo apt-get install -y figlet
sudo apt-get install -y toilet

# Display a heading for the CDN Survey installation
tput setaf 6
toilet -f big "Installing CDN Module Gaze" --gay
tput sgr0

# Define the source and destination
SOURCE="cdnmodulegaze.service"
DESTINATION="/etc/systemd/system/"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The installer runs in a subshell, so it cannot update this script's PATH.
# Sourcing ~/.bashrc is also unreliable here: non-interactive bash returns
# before the PATH line Bun appends.
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
fi

if [[ ! -x "$BUN_INSTALL/bin/bun" ]]; then
  echo "bun install finished but ${BUN_INSTALL}/bin/bun is missing." >&2
  exit 1
fi

export PATH="$BUN_INSTALL/bin:$PATH"
hash -r

echo "Installing dependencies with ${BUN_INSTALL}/bin/bun..."
# prisma, typescript, and tailwind are devDependencies required for `bun run build`.
# A production shell (NODE_ENV=production) would otherwise skip them.
NODE_ENV=development bun install

bun run build

# Copy the service file to the systemd directory, then point it at the
# bun binary and checkout that this install actually used.
sudo cp "$SOURCE" "$DESTINATION"
sudo sed -i \
  -e "s|^WorkingDirectory=.*|WorkingDirectory=${SCRIPT_DIR}|" \
  -e "s|^ExecStart=.*|ExecStart=${BUN_INSTALL}/bin/bun run start|" \
  "${DESTINATION}${SOURCE}"

# Reload systemd to recognize the new service
sudo systemctl daemon-reload

# Enable the service to start on boot
sudo systemctl enable cdnmodulegaze.service

# Restart so redeploys pick up new builds and env vars
sudo systemctl restart cdnmodulegaze.service

# Display a success message
tput setaf 2
echo "CDN Module Gaze has been installed and started successfully!"
tput sgr0