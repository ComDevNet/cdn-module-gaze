#!/bin/bash

sudo apt-get install -y figlet
sudo apt-get install -y toilet

# Display a heading for the CDN Survey installation
tput setaf 6
toilet -f big "Installing CDN Module Gaze" --gay
tput sgr0

# Define the source and destination
SOURCE="cdnmodulegaze.service"
DESTINATION="/etc/systemd/system/"

curl -fsSL https://bun.sh/install | bash # for macOS, Linux, and WSL

echo "Installing dependencies..."
bun install

bun run build

# Copy the service file to the systemd directory
sudo cp "$SOURCE" "$DESTINATION"

# Reload systemd to recognize the new service
sudo systemctl daemon-reload

# Enable the service to start on boot
sudo systemctl enable cdnmodulegaze.service

# Start the service immediately
sudo systemctl start cdnmodulegaze.service

# Display a success message
tput setaf 2
echo "CDN Module Gaze has been installed and started successfully!"
tput sgr0