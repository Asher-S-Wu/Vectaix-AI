#!/bin/bash
#
# Alpine Linux aarch64 Rootfs Preparation Script
# Creates a bootable qcow2 disk image for QEMU
#

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ALPINE_DIR="$PROJECT_ROOT/deps/alpine"
BUILD_DIR="$PROJECT_ROOT/build"

ALPINE_VERSION="3.21"
ALPINE_MINOR="0"
ALPINE_ARCH="aarch64"
ALPINE_MIRROR="https://dl-cdn.alpinelinux.org/alpine"

DISK_SIZE="2G"
OUTPUT_IMAGE="alpine-aarch64.qcow2"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "🔍 Checking prerequisites..."

    local missing=()

    if ! command -v qemu-img &> /dev/null; then
        missing+=("qemu-img (brew install qemu)")
    fi

    if ! command -v curl &> /dev/null; then
        missing+=("curl")
    fi

    if [ ${#missing[@]} -ne 0 ]; then
        log_error "Missing required tools:"
        for tool in "${missing[@]}"; do
            echo "  - $tool"
        done
        exit 1
    fi

    log_info "✅ Prerequisites satisfied"
}

# Download Alpine minirootfs
download_alpine() {
    log_info "📥 Downloading Alpine Linux $ALPINE_VERSION for $ALPINE_ARCH..."

    mkdir -p "$ALPINE_DIR"
    cd "$ALPINE_DIR"

    local ROOTFS_FILE="alpine-minirootfs-${ALPINE_VERSION}.${ALPINE_MINOR}-${ALPINE_ARCH}.tar.gz"
    local ROOTFS_URL="${ALPINE_MIRROR}/v${ALPINE_VERSION}/releases/${ALPINE_ARCH}/${ROOTFS_FILE}"

    if [ -f "$ROOTFS_FILE" ]; then
        log_info "Rootfs already downloaded: $ROOTFS_FILE"
    else
        log_info "Downloading from $ROOTFS_URL"
        curl -L -o "$ROOTFS_FILE" "$ROOTFS_URL"
    fi

    log_info "✅ Alpine rootfs ready"
}

# Download Alpine Virtual ISO (for kernel and initramfs)
download_alpine_iso() {
    log_info "📥 Downloading Alpine Virtual ISO..."

    cd "$ALPINE_DIR"

    local ISO_FILE="alpine-virt-${ALPINE_VERSION}.${ALPINE_MINOR}-${ALPINE_ARCH}.iso"
    local ISO_URL="${ALPINE_MIRROR}/v${ALPINE_VERSION}/releases/${ALPINE_ARCH}/${ISO_FILE}"

    if [ -f "$ISO_FILE" ]; then
        log_info "ISO already downloaded: $ISO_FILE"
    else
        log_info "Downloading from $ISO_URL"
        curl -L -o "$ISO_FILE" "$ISO_URL"
    fi

    # Extract kernel and initramfs from ISO
    log_info "Extracting kernel and initramfs from ISO..."

    mkdir -p iso_mount
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        hdiutil attach "$ISO_FILE" -mountpoint iso_mount -nobrowse -quiet || true
    else
        # Linux
        mount -o loop "$ISO_FILE" iso_mount || true
    fi

    if [ -f iso_mount/boot/vmlinuz-virt ]; then
        cp iso_mount/boot/vmlinuz-virt vmlinuz-virt
        cp iso_mount/boot/initramfs-virt initramfs-virt
        log_info "✅ Kernel and initramfs extracted"
    else
        log_warn "Could not extract kernel from ISO, will use alternative method"
    fi

    if [[ "$OSTYPE" == "darwin"* ]]; then
        hdiutil detach iso_mount -quiet 2>/dev/null || true
    else
        umount iso_mount 2>/dev/null || true
    fi
    rm -rf iso_mount

    log_info "✅ Alpine ISO processed"
}

# Create qcow2 disk image
create_disk_image() {
    log_info "💾 Creating qcow2 disk image..."

    cd "$ALPINE_DIR"

    local ROOTFS_FILE="alpine-minirootfs-${ALPINE_VERSION}.${ALPINE_MINOR}-${ALPINE_ARCH}.tar.gz"

    if [ -f "$OUTPUT_IMAGE" ]; then
        log_warn "Disk image already exists: $OUTPUT_IMAGE"
        read -p "Overwrite? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Keeping existing image"
            return
        fi
        rm -f "$OUTPUT_IMAGE"
    fi

    # Create empty qcow2 image
    log_info "Creating $DISK_SIZE qcow2 image..."
    qemu-img create -f qcow2 "$OUTPUT_IMAGE" "$DISK_SIZE"

    log_info "✅ Disk image created: $OUTPUT_IMAGE"
    log_info ""
    log_info "📋 Manual setup required:"
    log_info "   The disk image needs to be formatted and populated."
    log_info "   You can do this by booting the Alpine ISO in QEMU:"
    log_info ""
    log_info "   qemu-system-aarch64 \\"
    log_info "     -M virt -cpu cortex-a72 -m 1024 \\"
    log_info "     -drive file=$OUTPUT_IMAGE,if=virtio \\"
    log_info "     -cdrom alpine-virt-${ALPINE_VERSION}.${ALPINE_MINOR}-${ALPINE_ARCH}.iso \\"
    log_info "     -boot d -nographic"
    log_info ""
    log_info "   Then run 'setup-alpine' inside the VM."
}

# Create a pre-configured raw image (alternative method)
create_raw_image() {
    log_info "💾 Creating pre-configured raw disk image..."

    cd "$ALPINE_DIR"

    local ROOTFS_FILE="alpine-minirootfs-${ALPINE_VERSION}.${ALPINE_MINOR}-${ALPINE_ARCH}.tar.gz"
    local RAW_IMAGE="alpine-aarch64.raw"
    local LOOP_DEV=""

    if [ ! -f "$ROOTFS_FILE" ]; then
        log_error "Rootfs tarball not found: $ROOTFS_FILE"
        exit 1
    fi

    # Create raw image
    dd if=/dev/zero of="$RAW_IMAGE" bs=1M count=2048

    if [[ "$OSTYPE" == "linux"* ]]; then
        # Linux: Use loop device
        LOOP_DEV=$(losetup -f)
        losetup "$LOOP_DEV" "$RAW_IMAGE"

        # Create partition
        parted -s "$LOOP_DEV" mklabel gpt
        parted -s "$LOOP_DEV" mkpart primary ext4 1MiB 100%
        partprobe "$LOOP_DEV"

        # Format and mount
        mkfs.ext4 "${LOOP_DEV}p1"
        mkdir -p /tmp/alpine_mount
        mount "${LOOP_DEV}p1" /tmp/alpine_mount

        # Extract rootfs
        tar xzf "$ROOTFS_FILE" -C /tmp/alpine_mount

        # Configure for auto-login
        configure_alpine /tmp/alpine_mount

        # Cleanup
        umount /tmp/alpine_mount
        losetup -d "$LOOP_DEV"

        # Convert to qcow2
        qemu-img convert -f raw -O qcow2 "$RAW_IMAGE" "$OUTPUT_IMAGE"
        rm -f "$RAW_IMAGE"

        log_info "✅ Pre-configured disk image created: $OUTPUT_IMAGE"
    else
        log_warn "Raw image creation requires Linux. Using ISO method instead."
        rm -f "$RAW_IMAGE"
    fi
}

# Configure Alpine for headless boot
configure_alpine() {
    local ROOTFS="$1"

    log_info "⚙️  Configuring Alpine for auto-login..."

    # Create inittab for auto-login on ttyS0
    cat > "$ROOTFS/etc/inittab" << 'EOF'
::sysinit:/sbin/openrc sysinit
::sysinit:/sbin/openrc boot
::wait:/sbin/openrc default

# Auto-login on serial console
ttyS0::respawn:/bin/login -f root

# Ctrl-Alt-Del handling
::ctrlaltdel:/sbin/reboot

# Shutdown
::shutdown:/sbin/openrc shutdown
EOF

    # Configure networking
    cat > "$ROOTFS/etc/network/interfaces" << 'EOF'
auto lo
iface lo inet loopback

auto eth0
iface eth0 inet dhcp
EOF

    # Enable networking service
    mkdir -p "$ROOTFS/etc/runlevels/default"
    ln -sf /etc/init.d/networking "$ROOTFS/etc/runlevels/default/networking" 2>/dev/null || true

    # Set hostname
    echo "minis-vm" > "$ROOTFS/etc/hostname"

    # Create welcome message
    cat > "$ROOTFS/etc/motd" << 'EOF'

  __  __ _       _      __     ____  __
 |  \/  (_)_ __ (_)___  \ \   / /  \/  |
 | |\/| | | '_ \| / __|  \ \ / /| |\/| |
 | |  | | | | | | \__ \   \ V / | |  | |
 |_|  |_|_|_| |_|_|___/    \_/  |_|  |_|

 Welcome to MinisApp Alpine Linux VM
 Running on QEMU aarch64

EOF

    # Set root password (empty for auto-login)
    sed -i 's/^root:.*/root::0:0:root:\/root:\/bin\/ash/' "$ROOTFS/etc/passwd"

    log_info "✅ Alpine configured"
}

# Download prebuilt kernel
download_kernel() {
    log_info "📥 Downloading prebuilt aarch64 kernel..."

    cd "$ALPINE_DIR"

    # Use Alpine's kernel packages
    local KERNEL_PKG_URL="${ALPINE_MIRROR}/v${ALPINE_VERSION}/main/${ALPINE_ARCH}/linux-virt-${ALPINE_VERSION}.${ALPINE_MINOR}-r0.apk"

    # Alternative: download from releases
    if [ ! -f "vmlinuz-virt" ]; then
        log_info "Kernel will be extracted from Alpine ISO"
        download_alpine_iso
    fi
}

# Create boot configuration
create_boot_config() {
    log_info "📝 Creating boot configuration..."

    cd "$ALPINE_DIR"

    cat > "qemu-boot.sh" << 'EOF'
#!/bin/bash
# Quick test boot script for the Alpine image

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

qemu-system-aarch64 \
    -M virt \
    -cpu cortex-a72 \
    -m 1024 \
    -kernel "$SCRIPT_DIR/vmlinuz-virt" \
    -initrd "$SCRIPT_DIR/initramfs-virt" \
    -append "console=ttyAMA0 root=/dev/vda rw" \
    -drive file="$SCRIPT_DIR/alpine-aarch64.qcow2",if=virtio,format=qcow2 \
    -netdev user,id=net0 \
    -device virtio-net-device,netdev=net0 \
    -nographic

EOF
    chmod +x "qemu-boot.sh"

    log_info "✅ Boot configuration created: qemu-boot.sh"
}

# Main
main() {
    log_info "🏔️  Alpine Linux Rootfs Preparation"
    log_info "   Version: $ALPINE_VERSION.$ALPINE_MINOR"
    log_info "   Architecture: $ALPINE_ARCH"
    echo

    check_prerequisites
    download_alpine
    download_alpine_iso
    create_disk_image
    create_boot_config

    echo
    log_info "🎉 Preparation completed!"
    log_info ""
    log_info "Output files in $ALPINE_DIR:"
    ls -la "$ALPINE_DIR"/*.qcow2 "$ALPINE_DIR"/vmlinuz-* "$ALPINE_DIR"/initramfs-* 2>/dev/null || true
    echo
    log_info "To test the VM locally:"
    log_info "  cd $ALPINE_DIR && ./qemu-boot.sh"
    echo
    log_info "To use in MinisApp:"
    log_info "  Copy alpine-aarch64.qcow2 to the app bundle or download at runtime"
}

# Parse arguments
case "${1:-}" in
    --clean)
        log_info "Cleaning Alpine directory..."
        rm -rf "$ALPINE_DIR"
        log_info "✅ Clean completed"
        exit 0
        ;;
    --download-only)
        check_prerequisites
        download_alpine
        download_alpine_iso
        exit 0
        ;;
    --help)
        echo "Usage: $0 [OPTIONS]"
        echo ""
        echo "Options:"
        echo "  --clean          Clean all downloaded files"
        echo "  --download-only  Only download files, don't create image"
        echo "  --help           Show this help message"
        exit 0
        ;;
    *)
        main
        ;;
esac
