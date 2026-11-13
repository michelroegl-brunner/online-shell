#!/bin/sh
# Firewall for student boxes with internet access (run as root on the Docker
# host; idempotent, safe to run again).
#
# Boxes on the internet network (bridge interface `oshell-inet`, see
# INTERNET_BRIDGE in the runner) may reach the public internet only:
#   - no private / link-local ranges (school LAN, other stacks, metadata),
#     except DNS to the host's nameservers
#   - nothing on the Docker host itself (published ports, SSH, ...)
#
# The rules live in DOCKER-USER (forwarded traffic) and INPUT (traffic to the
# host) and don't survive a reboot: run this at boot, e.g. with
#   /etc/systemd/system/oshell-internet-firewall.service
#     [Unit]
#     After=docker.service
#     Requires=docker.service
#     [Service]
#     Type=oneshot
#     ExecStart=/opt/online-shell/internet-firewall.sh
#     [Install]
#     WantedBy=multi-user.target
set -eu

IF="${INTERNET_BRIDGE:-oshell-inet}"
CHAIN=OSHELL-INET

iptables -N "$CHAIN" 2>/dev/null || iptables -F "$CHAIN"

# Answers to connections the box opened.
iptables -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN

# DNS to the host's upstream resolvers (Docker's embedded DNS forwards to
# them from the box), even when they are on the LAN.
for ns in $(awk '/^nameserver/ { print $2 }' /etc/resolv.conf | grep -v -e '^127\.' -e ':'); do
  iptables -A "$CHAIN" -d "$ns" -p udp --dport 53 -j RETURN
  iptables -A "$CHAIN" -d "$ns" -p tcp --dport 53 -j RETURN
done

for net in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 \
           100.64.0.0/10 224.0.0.0/4 240.0.0.0/4; do
  iptables -A "$CHAIN" -d "$net" -j DROP
done

# Hook the chain in once.
iptables -N DOCKER-USER 2>/dev/null || true
iptables -C DOCKER-USER -i "$IF" -j "$CHAIN" 2>/dev/null ||
  iptables -I DOCKER-USER -i "$IF" -j "$CHAIN"

# The host itself (its LAN IP, the bridge gateway, published ports).
iptables -C INPUT -i "$IF" -j DROP 2>/dev/null ||
  iptables -I INPUT -i "$IF" -j DROP

echo "internet firewall for $IF is in place"
