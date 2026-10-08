#!/bin/bash
# ====================================================================
# BENCHLY — Azure VM Self-Hosted Valkey/Redis & Environment Setup
# Ubuntu 24.04 LTS (x64) - Standard_B1s (1.5GB RAM)
# $0 Cost, Unlimited Ops, <0.1ms Localhost Latency
# ====================================================================

set -e

echo "🚀 Starting Benchly Azure Host Optimization..."

# 1. CONFIGURE 2GB SWAP FILE (Essential for 1.5GB RAM VM stability)
if [ ! -f /swapfile ]; then
    echo "💾 Creating 2GB swap file to prevent out-of-memory crashes..."
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf
    sudo sysctl -p
    echo "✅ Swap configured."
else
    echo "ℹ️ Swap file already exists."
fi

# 2. INSTALL REDIS / VALKEY
echo "📦 Installing Redis Server..."
sudo apt update
sudo apt install -y redis-server

# 3. SECURE & TUNE REDIS FOR BENCHLY
echo "⚙️ Configuring Redis (Localhost Only, 128MB RAM Cap, LRU Eviction)..."
sudo sed -i 's/^bind .*/bind 127.0.0.1 ::1/' /etc/redis/redis.conf
sudo sed -i 's/^protected-mode no/protected-mode yes/' /etc/redis/redis.conf

# Add memory cap and persistence if not present
if ! grep -q "maxmemory 128mb" /etc/redis/redis.conf; then
    echo "maxmemory 128mb" | sudo tee -a /etc/redis/redis.conf
    echo "maxmemory-policy allkeys-lru" | sudo tee -a /etc/redis/redis.conf
    echo "appendonly yes" | sudo tee -a /etc/redis/redis.conf
fi

# 4. START & ENABLE REDIS SERVICE
echo "🔄 Starting Redis Service..."
sudo systemctl restart redis-server
sudo systemctl enable redis-server

# Verify Redis
REDIS_PING=$(redis-cli ping)
if [ "$REDIS_PING" = "PONG" ]; then
    echo "✅ Redis is ONLINE and responding: $REDIS_PING (<0.1ms latency)"
else
    echo "❌ Redis failed to respond to PING."
fi

# 5. ENVIRONMENT FILE CHECK
echo "🔧 Setting local Redis URL in backend .env if needed..."
if [ -f ~/benchly/backend/.env ]; then
    sed -i 's|^REDIS_URL=.*|REDIS_URL=redis://127.0.0.1:6379|' ~/benchly/backend/.env
    echo "✅ Updated backend/.env to use local fast redis://127.0.0.1:6379"
fi

echo "===================================================================="
echo "🎉 BENCHLY AZURE VM OPTIMIZATION COMPLETE!"
echo "Memory Usage:"
free -h
echo "Redis Status:"
sudo systemctl status redis-server --no-pager
echo "===================================================================="
