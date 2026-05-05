#!/usr/bin/env bash
set -euo pipefail

# FortunaPanel — Linux Install Script
# Installs Node.js 22, Java 17, clones the repo, and sets up a systemd service.
# Usage: curl -fsSL https://raw.githubusercontent.com/FortunasXP/FortunaPanel/master/install.sh | bash

INSTALL_DIR="/opt/fortunapanel"
SERVICE_NAME="fortunapanel"
PANEL_PORT=3000
REPO_URL="https://github.com/FortunasXP/FortunaPanel.git"

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║        FortunaPanel Installer          ║"
echo "  ║   Minecraft Server Management Panel    ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""

# Check root
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: Please run as root (sudo bash install.sh)"
    exit 1
fi

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    echo "ERROR: Cannot detect OS. This script supports Ubuntu/Debian and CentOS/RHEL/Fedora."
    exit 1
fi

echo "[1/6] Installing system dependencies..."

case $OS in
    ubuntu|debian)
        apt-get update -qq
        apt-get install -y -qq curl git openjdk-17-jre-headless > /dev/null 2>&1
        ;;
    centos|rhel|fedora|rocky|alma)
        dnf install -y -q curl git java-17-openjdk-headless > /dev/null 2>&1 || \
        yum install -y -q curl git java-17-openjdk-headless > /dev/null 2>&1
        ;;
    *)
        echo "WARNING: Unsupported OS '$OS'. Please install git, Java 17, and Node.js 22 manually."
        ;;
esac

echo "[2/6] Installing Node.js 22..."

if command -v node &> /dev/null && [[ "$(node -v)" == v22* || "$(node -v)" == v23* || "$(node -v)" == v24* ]]; then
    echo "  Node.js $(node -v) already installed, skipping."
else
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - > /dev/null 2>&1
    apt-get install -y -qq nodejs > /dev/null 2>&1 || dnf install -y -q nodejs > /dev/null 2>&1
fi

echo "  Node.js $(node -v)"
echo "  Java $(java -version 2>&1 | head -1)"

echo "[3/6] Cloning FortunaPanel..."

if [ -d "$INSTALL_DIR" ]; then
    echo "  Directory exists, pulling latest..."
    cd "$INSTALL_DIR"
    git pull --quiet
else
    git clone --quiet "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

echo "[4/6] Installing dependencies..."

npm ci --omit=dev --ignore-scripts --silent 2>&1

# Create data directories
mkdir -p data servers logs

echo "[5/6] Configuring environment..."

if [ ! -f .env ]; then
    JWT_SECRET=$(openssl rand -hex 32)
    cat > .env <<EOL
PORT=${PANEL_PORT}
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRY=24h
SERVERS_ROOT=./servers
DATA_DIR=./data
JAVA_PATH=java
MAX_SERVERS=10
LOG_LEVEL=info
EOL
    echo "  Created .env with auto-generated JWT secret"
else
    echo "  .env already exists, skipping"
fi

echo "[6/6] Creating systemd service..."

cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOL
[Unit]
Description=FortunaPanel - Minecraft Server Manager
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOL

systemctl daemon-reload
systemctl enable ${SERVICE_NAME} --quiet
systemctl restart ${SERVICE_NAME}

echo ""
echo "  ✓ FortunaPanel installed successfully!"
echo ""
echo "  Panel URL:  http://$(hostname -I | awk '{print $1}'):${PANEL_PORT}"
echo "  Install dir: ${INSTALL_DIR}"
echo "  Service:     systemctl status ${SERVICE_NAME}"
echo ""
echo "  Open the URL above and create your admin account."
echo "  Manage the service with:"
echo "    systemctl start ${SERVICE_NAME}"
echo "    systemctl stop ${SERVICE_NAME}"
echo "    systemctl restart ${SERVICE_NAME}"
echo "    journalctl -u ${SERVICE_NAME} -f    # view logs"
echo ""
