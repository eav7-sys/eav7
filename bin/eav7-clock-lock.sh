#!/usr/bin/env bash
# Trava NTP nas VMs EAV7 — slots de 1s não toleram drift de VMware Tools.
# Uso: bash bin/eav7-clock-lock.sh
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/eav7-deploy-lib.sh"
eav7_deploy_load

lock_one() {
  local ip="$1"
  eav7_deploy_say "CLOCK $ip"
  eav7_deploy_ssh "$ip" 'sudo bash -s' <<'EOS'
set -euo pipefail
if command -v vmware-toolbox-cmd >/dev/null 2>&1; then
  vmware-toolbox-cmd timesync disable || true
fi
mkdir -p /etc/vmware-tools
printf '[timesync]\nenable=false\n' > /etc/vmware-tools/tools.conf
mkdir -p /etc/chrony/conf.d
cat > /etc/chrony/conf.d/eav7-makestep.conf <<'CONF'
makestep 0.1 -1
maxchange 1000 0 0
CONF
systemctl stop chrony || true
rm -f /var/lib/chrony/chrony.drift /var/lib/chrony/drift || true
chronyd -q -t 30 'server time.cloudflare.com iburst' 'server ntp.ubuntu.com iburst' || true
systemctl start chrony
sleep 2
chronyc makestep || true
chronyc burst 4/4 || true
sleep 2
chronyc makestep || true
echo -n "timesync="; vmware-toolbox-cmd timesync status 2>/dev/null || echo n/a
chronyc tracking | grep -E 'System time|Leap|Stratum|Last offset' || true
date -u +%Y-%m-%dT%H:%M:%SZ
EOS
}

i=0
while (( i < ${#EAV7_NODE_PAIRS[@]} )); do
  ip="${EAV7_NODE_PAIRS[i+1]}"
  lock_one "$ip"
  i=$((i + 2))
done
