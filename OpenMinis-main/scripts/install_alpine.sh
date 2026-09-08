#!/bin/bash
#
# Alpine Linux Installation Script
# Installs Alpine to qcow2 disk image using QEMU
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ALPINE_DIR="$PROJECT_ROOT/deps/alpine"

ISO_FILE="$ALPINE_DIR/alpine-virt-3.21.0-aarch64.iso"
DISK_FILE="$ALPINE_DIR/alpine-aarch64.qcow2"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Check files exist
if [ ! -f "$ISO_FILE" ]; then
    echo "Error: ISO file not found: $ISO_FILE"
    echo "Run scripts/prepare_rootfs.sh first"
    exit 1
fi

if [ ! -f "$DISK_FILE" ]; then
    echo "Error: Disk image not found: $DISK_FILE"
    echo "Run scripts/prepare_rootfs.sh first"
    exit 1
fi

log_info "🏔️  Alpine Linux Installation"
log_info ""
log_info "This will boot Alpine in QEMU and you need to run setup-alpine manually."
log_info ""
log_info "Quick setup instructions:"
log_info "  1. Login as 'root' (no password)"
log_info "  2. Run: setup-alpine"
log_info "  3. Select keyboard layout: us"
log_info "  4. Hostname: minis-vm"
log_info "  5. Network: eth0, dhcp"
log_info "  6. Root password: (set a simple one like 'root')"
log_info "  7. Timezone: UTC"
log_info "  8. Proxy: none"
log_info "  9. Mirror: 1 (or press Enter for default)"
log_info "  10. SSH server: openssh"
log_info "  11. Disk: vda, sys mode"
log_info "  12. Confirm erase: y"
log_info ""
log_info "After installation completes:"
log_info "  - Run: poweroff"
log_info "  - Press Ctrl+A then X to exit QEMU"
log_info ""
log_warn "Press Enter to start QEMU..."
read

log_info "Starting QEMU with Alpine ISO..."

qemu-system-aarch64 \
    -M virt \
    -cpu cortex-a72 \
    -m 1024 \
    -drive file="$DISK_FILE",if=virtio,format=qcow2 \
    -cdrom "$ISO_FILE" \
    -boot d \
    -netdev user,id=net0 \
    -device virtio-net-device,netdev=net0 \
    -nographic

log_info ""
log_info "✅ QEMU exited"
log_info ""
log_info "If installation was successful, the disk image is ready."
log_info "Disk image: $DISK_FILE"
log_info ""
log_info "To test boot from disk (without ISO):"
log_info "  qemu-system-aarch64 -M virt -cpu cortex-a72 -m 1024 \\"
log_info "    -drive file=$DISK_FILE,if=virtio,format=qcow2 \\"
log_info "    -netdev user,id=net0 -device virtio-net-device,netdev=net0 \\"
log_info "    -nographic"
